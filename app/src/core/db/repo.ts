/**
 * 数据访问层。所有 IndexedDB 读写集中在这里，UI 与纯函数都不直接碰 db。
 *
 * 三条纪律：
 * 1. 写档案必须同时维护目标快照（ensureGoal），否则今日页会拿到过期目标。
 * 2. 删除一律软删（deletedAt），回收站与「撤销」都靠它。
 * 3. 渲染路径只读 meals.items[].nutrition 快照，绝不 join foods 表。
 */

import { nanoid } from 'nanoid';
import { db } from './schema';
import type {
  AdviceSnapshot,
  BpEntry, BpFlags, BpTimeSource,
  ChatMessage,
  Food, GoalSnapshot, Meal, PortionTier, Profile, Settings, WeightEntry,
} from './types';
import { buildGoalSnapshot, profileHash } from '../goal/engine';
import { compareBp } from '../bp/engine';
import { normalizeName } from '../food/normalize';
import { SEED_VERSION } from '../food/seedVersion';
import { dayKey, DEFAULT_DAY_START_HOUR } from '../date';
import { learnBias } from '../portion/tier';

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  mode: 'direct',
  provider: 'qwen',
  visionModel: 'qwen3-vl-plus',
  textModel: 'qwen-plus',
  apiKeyCipher: null,
  jsonCapability: 'json_object',
  imageMaxEdge: 1024,
  imageQuality: 0.82,
  dayStartHour: DEFAULT_DAY_START_HOUR,
  autoPurgePhotosDays: 30,
  categoryBias: {},
  theme: 'system',
  seedVersion: 0,
  lastBackupAt: null,
  updatedAt: 0,
};

/**
 * 引导表单的初始值。**不是一个人**。
 *
 * 这里每一个数字都只是控件打开时的起点，`onboardedAt: null` 就是在标记这件事。
 * 之前的版本把这份值直接写库并算目标，导致任何人第一次打开都会被告知
 * 「目标 1,902 kcal」——那是按一个 175cm/78kg/30 岁男性算出来的，
 * 与使用者无关，却看起来像是为他算的。
 *
 * 代价说清楚：一个从没填过的人，身高体重的初始值看着像「已填」。
 * 所以引导页必须把「请改成你自己的」写在字段旁边，而不是靠占位符暗示。
 */
export function newProfile(): Profile {
  return {
    id: 'me',
    sex: 'male',
    birthDate: '1996-04-18',
    heightCm: 175,
    weightKg: 78,
    bodyFatPct: null,
    waistCm: null,
    activityLevel: 'light',
    exerciseTypes: [],
    exerciseDaysPerWeek: 2,
    goalType: 'lose',
    targetWeightKg: 68,
    paceKgPerWeek: 0.5,
    specialStates: [],
    conditions: [],
    allergies: [],
    dietPrefs: [],
    onboardedAt: null,
    updatedAt: Date.now(),
  };
}

// ── 设置 ──────────────────────────────────────────────────
export async function loadSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  if (!s) {
    await db.settings.put(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await loadSettings();
  const next = { ...cur, ...patch, id: 'app' as const, updatedAt: Date.now() };
  await db.settings.put(next);
  return next;
}

// ── 食物库 ────────────────────────────────────────────────
/**
 * 灌入种子库。已存在则跳过，不覆盖用户改过的数据。
 *
 * **种子数据表是动态 import 的，别把它提到文件顶部。**
 * seed.ts 有 1170 行 / 174 条（13 项微矿的唯一来源），是首屏主包里中文字符的大头；
 * 而下面的早退分支意味着**绝大多数启动根本走不到它**（只有首装与种子版本升级才需要）。
 * 静态引入 = 每次打开 App 都先下载一张这一次用不上的表。
 *
 * 时序不变：ensureSeed 仍然在 bootstrap() 里、算 goal 之前被 await 完成，
 * 不能改成 fire-and-forget —— 引导页与今日页的匹配都依赖 preset 已就位。
 */
export async function ensureSeed(): Promise<number> {
  const settings = await loadSettings();
  if (settings.seedVersion === SEED_VERSION) {
    const n = await db.foods.where('source').equals('preset').count();
    if (n > 0) return 0;
  }

  // 走到这里才真正需要数据表
  const { SEED_FOODS } = await import('../food/seed');

  const now = Date.now();
  const rows: Food[] = SEED_FOODS.map((s) => ({
    id: s.id,
    name: s.name,
    nameKey: normalizeName(s.name),
    aliases: s.aliases,
    aliasKeys: s.aliases.map(normalizeName),
    userAliases: [],
    category: s.category,
    source: 'preset',
    priority: 50,
    per100g: s.per100g,
    serving: s.serving,
    edibleRatio: 1,
    personalBias: 1,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));

  const existing = new Map<string, Food>();
  for (const f of await db.foods.where('source').equals('preset').toArray()) existing.set(f.id, f);

  const toAdd: Food[] = [];
  const toUpdate: Food[] = [];
  for (const r of rows) {
    const old = existing.get(r.id);
    if (!old) {
      toAdd.push(r);
      continue;
    }
    // 版本升级时刷新「营养数据」本身，但保留 usageCount / personalBias / biasSamples ——
    // 那是用户自己攒下的份量学习信号，被一次升级抹掉等于白喂了三个月。
    toUpdate.push({
      ...old,
      name: r.name,
      nameKey: r.nameKey,
      aliases: r.aliases,
      aliasKeys: r.aliasKeys,
      category: r.category,
      per100g: r.per100g,
      serving: r.serving,
      updatedAt: now,
    });
  }

  if (toAdd.length > 0) await db.foods.bulkPut(toAdd);
  if (toUpdate.length > 0) await db.foods.bulkPut(toUpdate);

  await patchSettings({ seedVersion: SEED_VERSION });
  return toAdd.length;
}

export async function allFoods(): Promise<Food[]> {
  const list = await db.foods.toArray();
  return list.filter((f) => f.deletedAt == null);
}

export async function upsertFood(
  input: Pick<Food, 'name' | 'per100g'> & Partial<Pick<Food, 'aliases' | 'category' | 'serving' | 'source'>>,
  /** 明确指定要覆盖哪一条（改名场景靠它，否则会按 nameKey 新建出一条重复的） */
  existingId?: string | null,
): Promise<Food> {
  const now = Date.now();
  const nameKey = normalizeName(input.name);

  const forced = existingId ? await db.foods.get(existingId) : null;
  const target = input.source ?? 'custom';
  // v2 起 nameKey 不再唯一：同名可以同时存在「内置」与「自定义」各一条。
  // 这里只找 source 相同的那条，绝不拿内置条目当覆盖目标。
  const byName = await db.foods.where('nameKey').equals(nameKey).toArray();
  const exist = forced ?? byName.find((f) => f.source === target) ?? null;

  // 内置条目不允许被自定义数据覆盖：那会把整理好的公共数据改坏
  const overwritable = exist != null && exist.source !== 'preset';

  if (exist && overwritable) {
    const next: Food = {
      ...exist,
      name: input.name,
      nameKey,
      per100g: input.per100g,
      aliases: input.aliases ?? exist.aliases,
      aliasKeys: (input.aliases ?? exist.aliases).map(normalizeName),
      category: input.category ?? exist.category,
      serving: input.serving !== undefined ? input.serving : exist.serving,
      updatedAt: now,
    };
    await db.foods.put(next);
    return next;
  }
  const food: Food = {
    id: `food_${nanoid(10)}`,
    name: input.name,
    nameKey,
    aliases: input.aliases ?? [],
    aliasKeys: (input.aliases ?? []).map(normalizeName),
    userAliases: [],
    category: input.category ?? '自定义',
    source: target,
    priority: target === 'custom' ? 100 : 80,
    per100g: input.per100g,
    serving: input.serving ?? null,
    edibleRatio: 1,
    personalBias: 1,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.foods.put(food);
  return food;
}

/**
 * 给某条食物补一个「用户别名」。
 *
 * 为什么不是 upsertFood：那个函数有 `exist.source !== 'preset'` 守卫，
 * 内置条目改不动（而且 ensureSeed 会用 SEED_FOODS 的 aliases 覆盖回去）。
 * 用户别名单独放在 userAliases 里，种子升级不碰它，所以能活下来。
 *
 * 冲突检查是必须的：一个写法只能指向一条食物。否则「草鱼」既是「鲈鱼」的别名、
 * 又是「草鱼」自己的主名，findMatch 就变成了看谁先遍历到 —— 那就是随机结果。
 */
export async function addUserAlias(
  foodId: string,
  aliasRaw: string,
): Promise<'ok' | 'empty' | 'missing' | 'exists' | 'conflict'> {
  const alias = aliasRaw.trim();
  const key = normalizeName(alias);
  if (!key) return 'empty';

  const all = (await db.foods.toArray()).filter((f) => f.deletedAt == null);
  const target = all.find((f) => f.id === foodId);
  if (!target) return 'missing';

  const owns = (f: Food, k: string) =>
    f.nameKey === k
    || (f.aliasKeys ?? []).includes(k)
    || (f.userAliases ?? []).some((a) => normalizeName(a) === k);

  if (owns(target, key)) return 'exists';
  // 单字别名会把同字食物全吃掉（「鱼」曾让草鱼/鲫鱼/黄鱼全部匹配到鲈鱼），一律拒绝
  if (key.length < 2) return 'empty';
  if (all.some((f) => f.id !== foodId && owns(f, key))) return 'conflict';

  await db.foods.update(foodId, {
    userAliases: [...(target.userAliases ?? []), alias],
    updatedAt: Date.now(),
  });
  return 'ok';
}

/**
 * 记录一次「用户真的点了档位」，并重算个人偏置。
 *
 * 只有 tierConfirmed=true 的项才该调用这里 —— 默认中份是「没表态」，
 * 若混进样本池，算法会永远认为零偏差，学习等于关闭。
 */
export async function recordTierSample(foodId: string, tier: PortionTier): Promise<void> {
  const f = await db.foods.get(foodId);
  if (!f) return;

  const factor = tier === 'small' ? 0.7 : tier === 'large' ? 1.3 : 1;
  const samples = [...(f.biasSamples ?? []), { factor, at: Date.now() }].slice(-20);
  const { bias } = learnBias(samples);

  await db.foods.put({ ...f, biasSamples: samples, personalBias: bias, updatedAt: Date.now() });
}

export async function bumpFoodUsage(id: string): Promise<void> {
  const f = await db.foods.get(id);
  if (!f) return;
  await db.foods.put({ ...f, usageCount: f.usageCount + 1, lastUsedAt: Date.now() });
}

// ── 档案与目标 ─────────────────────────────────────────────
export async function loadProfile(): Promise<Profile | null> {
  return (await db.profile.get('me')) ?? null;
}

export async function saveProfile(p: Profile, day: string = dayKey(new Date(), DEFAULT_DAY_START_HOUR)): Promise<GoalSnapshot> {
  const next = { ...p, id: 'me' as const, updatedAt: Date.now() };
  await db.profile.put(next);
  return ensureGoal(next, day);
}

/**
 * 取当天生效的目标快照。
 * 档案指纹变了才重建，否则一直复用 —— 保证历史记录绑定的是当时的目标。
 */
export async function ensureGoal(p: Profile, day: string): Promise<GoalSnapshot> {
  const hash = profileHash(p);
  const all = await db.goals.orderBy('effectiveFrom').reverse().toArray();
  const latest = all.find((g) => g.effectiveFrom <= day);

  if (latest && latest.sourceProfileHash === hash) return latest;

  const snap = buildGoalSnapshot(p, { from: day });
  // 同一天同一指纹重复计算结果一致，直接覆盖即可
  await db.goals.put(snap);
  return snap;
}

/** 历史某天用的目标（统计页需要），找不到就退回当前快照 */
export async function goalForDay(day: string, fallback: GoalSnapshot): Promise<GoalSnapshot> {
  const all = await db.goals.orderBy('effectiveFrom').reverse().toArray();
  return all.find((g) => g.effectiveFrom <= day) ?? fallback;
}

// ── 餐次 ──────────────────────────────────────────────────
export async function mealsOfDay(day: string): Promise<Meal[]> {
  const list = await db.meals.where('date').equals(day).toArray();
  return list
    .filter((m) => m.deletedAt == null)
    .sort((a, b) => a.eatenAt - b.eatenAt);
}

export async function mealsInRange(from: string, to: string): Promise<Meal[]> {
  const list = await db.meals.where('date').between(from, to, true, true).toArray();
  return list.filter((m) => m.deletedAt == null);
}

export async function saveMeal(meal: Meal): Promise<void> {
  await db.meals.put(meal);
}

export async function softDeleteMeal(id: string): Promise<void> {
  const m = await db.meals.get(id);
  if (!m) return;
  await db.meals.put({ ...m, deletedAt: Date.now() });
}

export async function restoreMeal(id: string): Promise<void> {
  const m = await db.meals.get(id);
  if (!m) return;
  await db.meals.put({ ...m, deletedAt: null });
}

// ── 体重 ──────────────────────────────────────────────────
export async function upsertWeight(day: string, weightKg: number, bodyFatPct: number | null = null): Promise<void> {
  const exist = await db.weights.where('date').equals(day).first();
  const entry: WeightEntry = {
    id: exist?.id ?? `w_${day}`,
    date: day,
    weightKg,
    bodyFatPct,
    waistCm: exist?.waistCm ?? null,
    note: exist?.note ?? null,
    createdAt: exist?.createdAt ?? Date.now(),
  };
  await db.weights.put(entry);
}

export async function recentWeights(limit = 30): Promise<WeightEntry[]> {
  const all = await db.weights.orderBy('date').reverse().limit(limit).toArray();
  return all.reverse();
}

/** 最近一条体重记录。用于「补录历史时不要改档案」的判断 */
export async function latestWeight(): Promise<WeightEntry | null> {
  const top = await db.weights.orderBy('date').reverse().limit(1).toArray();
  return top[0] ?? null;
}

/**
 * 体脂秤识别结果的写入。
 *
 * 为什么不能直接复用 upsertWeight：两者的 **bodyFatPct 为 null 时的语义相反**。
 *
 * - upsertWeight：null 就是 null。档案页用户把体脂率清空后保存，是在主动表达
 *   "我不要这个值了"，必须能清掉。
 * - 这里：null 表示"这次截图里没读到体脂率"，不等于"体脂率不存在"。
 *   若沿用 upsertWeight，只测了体重的日子会把当天已有的体脂率抹成 null，
 *   而档案那边还留着 22.8% —— 两处数据从此不一致，且没有任何界面会报错。
 *
 * 所以这里显式保留原值。语义写在函数签名上，而不是靠调用方记得先查一遍。
 */
export async function upsertWeightScale(
  day: string,
  weightKg: number,
  bodyFatPct: number | null,
): Promise<WeightEntry> {
  const exist = await db.weights.where('date').equals(day).first();
  const entry: WeightEntry = {
    id: exist?.id ?? `w_${day}`,
    date: day,
    weightKg,
    bodyFatPct: bodyFatPct ?? exist?.bodyFatPct ?? null,
    waistCm: exist?.waistCm ?? null,
    note: exist?.note ?? null,
    createdAt: exist?.createdAt ?? Date.now(),
  };
  await db.weights.put(entry);
  return entry;
}

// ── 血压 ──────────────────────────────────────────────────
/**
 * 血压读写。
 *
 * 两条纪律：
 * 1. **date 由调用方算好一起存进来**，查询路径绝不再算一遍。
 *    理由是 dayStartHour 是可变的设置：若查询时重算，用户把「几点切日」
 *    从 0 改成 4，历史记录会集体错位一天 —— 而错位是静默的，看不出来。
 * 2. 删除仍然软删。删错一条血压记录的代价和删错一餐一样，
 *    用户会发现「上周的记录怎么没了」，却没法找回。
 */
export interface BpInput {
  /** 不给则新建；给了就是改一条已有的（读数看错了要纠的场景） */
  id?: string;
  measuredAt: number;
  date: string;
  systolic: number;
  diastolic: number;
  pulse?: number | null;
  device?: string | null;
  source: BpEntry['source'];
  timeSource: BpTimeSource;
  flags?: BpFlags | null;
  note?: string | null;
  aiMeta?: BpEntry['aiMeta'];
}

function aliveBp(b: BpEntry): boolean {
  return b.deletedAt == null;
}

export async function putBp(input: BpInput): Promise<BpEntry> {
  const now = Date.now();
  let base: Partial<BpEntry> = { createdAt: now, deletedAt: null };

  if (input.id) {
    const exist = await db.bps.get(input.id);
    if (exist) base = { createdAt: exist.createdAt, deletedAt: exist.deletedAt };
  }

  const entry: BpEntry = {
    id: input.id ?? `bp_${nanoid(10)}`,
    measuredAt: input.measuredAt,
    date: input.date,
    systolic: input.systolic,
    diastolic: input.diastolic,
    pulse: input.pulse ?? null,
    device: input.device ?? null,
    source: input.source,
    timeSource: input.timeSource,
    flags: input.flags ?? null,
    note: input.note ?? null,
    aiMeta: input.aiMeta ?? null,
    createdAt: base.createdAt ?? now,
    updatedAt: now,
    deletedAt: base.deletedAt ?? null,
  };
  await db.bps.put(entry);
  return entry;
}

export async function softDeleteBp(id: string): Promise<void> {
  const b = await db.bps.get(id);
  if (!b) return;
  await db.bps.put({ ...b, deletedAt: Date.now(), updatedAt: Date.now() });
}

export async function restoreBp(id: string): Promise<void> {
  const b = await db.bps.get(id);
  if (!b) return;
  await db.bps.put({ ...b, deletedAt: null, updatedAt: Date.now() });
}

/**
 * 最近一次测量（按真实时刻，不是按归档日 —— 熬夜到 3 点的记录也算今天）。
 *
 * 不从 db 直接 first()：同一分钟的两条 measuredAt 相同，Dexie 会用主键收尾，
 * 而主键是随机 nanoid —— 「最近一次」会变成抽奖。取头部一小段自己比。
 */
export async function latestBp(): Promise<BpEntry | null> {
  const head = await db.bps.orderBy('measuredAt').reverse().filter(aliveBp).limit(50).toArray();
  if (head.length === 0) return null;
  return head.reduce((best, b) => (compareBp(b, best) > 0 ? b : best), head[0]);
}

export async function bpsOfDay(day: string): Promise<BpEntry[]> {
  const rows = await db.bps.where('date').equals(day).toArray();
  return rows.filter(aliveBp).sort(compareBp);
}

/** 按归档日取区间，两端都包含。周期窗口的数据源 */
export async function bpsInRange(from: string, to: string): Promise<BpEntry[]> {
  const rows = await db.bps.where('date').between(from, to, true, true).toArray();
  return rows.filter(aliveBp).sort(compareBp);
}

export async function recentBps(limit = 60): Promise<BpEntry[]> {
  const all = await db.bps.orderBy('measuredAt').reverse().filter(aliveBp).limit(limit).toArray();
  return all.sort(compareBp);
}

// ── 首次启动编排 ───────────────────────────────────────────
export interface BootstrapResult {
  profile: Profile;
  /**
   * 引导未完成时为 `null`。
   *
   * 目标必须由**真实**档案算出。以前这里在没人填过的情况下也返回一个
   * 快照（按默认 175cm/78kg 男性算），首页于是显示一个看起来个人化、
   * 实际与使用者无关的热量目标。宁可没有目标，也不能有假目标。
   */
  goal: GoalSnapshot | null;
  seeded: number;
  onboarded: boolean;
}

/**
 * 首次启动编排。
 *
 * 分三种情况，不要合并：
 * ① 库里没有档案 → 什么都不写，返回 `onboarded: false`，由引导页收集数据后
 *    调 `completeOnboarding` 一次写全。**不记体重**——那时还没有真体重。
 * ② 有档案但没有 `onboardedAt` → 老版本用户，补上标记视为已完成。
 * ③ 有档案且有标记 → 正常路径，复用或重算目标。
 */
export async function bootstrap(): Promise<BootstrapResult> {
  const settings = await loadSettings();
  const day = dayKey(new Date(), settings.dayStartHour);
  const seeded = await ensureSeed();

  const existing = await loadProfile();

  if (!existing) {
    return { profile: newProfile(), goal: null, seeded, onboarded: false };
  }

  let profile = existing;
  if (profile.onboardedAt == null) {
    // 老用户的档案是真实填过的（旧版本没有这个字段），补标记而不是重置
    profile = { ...profile, onboardedAt: profile.updatedAt || Date.now() };
    await db.profile.put(profile);
  }

  const goal = await ensureGoal(profile, day);
  return { profile, goal, seeded, onboarded: true };
}

/**
 * 引导完成：唯一一个把占位档案变成真实档案的入口。
 *
 * 顺序不能反：先写档案再记体重。`upsertWeight` 传 null 会保留当天已有的
 * 体脂率，所以这里直接把 `bodyFatPct` 透传下去即可。
 */
export async function completeOnboarding(
  p: Profile,
  day: string,
): Promise<{ profile: Profile; goal: GoalSnapshot }> {
  const now = Date.now();
  const next: Profile = { ...p, id: 'me', onboardedAt: now, updatedAt: now };

  await db.profile.put(next);
  await upsertWeight(day, next.weightKg, next.bodyFatPct);

  const goal = await ensureGoal(next, day);
  return { profile: next, goal };
}

// ── 食物库维护 ─────────────────────────────────────────────
export async function softDeleteFood(id: string): Promise<void> {
  const f = await db.foods.get(id);
  if (!f) return;
  await db.foods.put({ ...f, deletedAt: Date.now(), updatedAt: Date.now() });
}

/** 用户自建条目（用于聊天里的指代与"已有食物"提醒） */
export async function customFoods(): Promise<Food[]> {
  const list = await db.foods.where('source').equals('custom').toArray();
  return list.filter((f) => f.deletedAt == null);
}

// ── 聊天记录 ───────────────────────────────────────────────
export async function addChat(
  msg: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string },
): Promise<ChatMessage> {
  // createdAt 必须单调递增：一条用户消息和它引发的回复常常落在同一毫秒，
  // 只按时间戳排序会让同毫秒的几条按主键（随机 nanoid）乱序，聊天记录就读不通了。
  const last = await db.chat.orderBy('createdAt').last();
  const now = Date.now();
  const createdAt = last ? Math.max(now, last.createdAt + 1) : now;
  const row: ChatMessage = { ...msg, id: msg.id ?? `chat_${nanoid(10)}`, createdAt };
  await db.chat.put(row);
  return row;
}

export async function recentChat(limit = 40): Promise<ChatMessage[]> {
  const all = await db.chat.orderBy('createdAt').reverse().limit(limit).toArray();
  return all.reverse();
}

export async function setChatStatus(
  id: string,
  status: ChatMessage['status'],
): Promise<void> {
  const m = await db.chat.get(id);
  if (!m) return;
  await db.chat.put({ ...m, status });
}

/** 把还挂着的待确认卡全部作废 —— 用户发了新消息，旧卡就不该再等他点 */
export async function rejectPendingChats(): Promise<number> {
  const pending = await db.chat.where('status').equals('pending').toArray();
  for (const m of pending) await db.chat.put({ ...m, status: 'rejected' });
  return pending.length;
}

export async function clearChat(): Promise<void> {
  await db.chat.clear();
}

// ── 周期报告 ────────────────────────────────────────────────
/** 目标快照全部取回后由纯函数解析时间线，避免按天查库（季度要查 90 次） */
export async function allGoals(): Promise<GoalSnapshot[]> {
  return db.goals.toArray();
}

export async function weightsInRange(from: string, to: string): Promise<WeightEntry[]> {
  return db.weights.where('date').between(from, to, true, true).sortBy('date');
}

// ── 每日建议缓存 ────────────────────────────────────────────
export async function adviceForDay(
  date: string,
  hash: string,
): Promise<AdviceSnapshot | null> {
  const hit = await db.advices.where('[date+profileHash]').equals([date, hash]).first();
  if (!hit) return null;
  // 旧版本写入的条目结构不同（没有 inputs / actions），当成没有，
  // 否则界面会在 saved.inputs.kcal 上直接崩
  if (!hit.inputs || typeof hit.headline !== 'string' || !Array.isArray(hit.actions)) return null;
  return hit;
}

export async function saveAdvice(
  input: Omit<AdviceSnapshot, 'id' | 'createdAt'> & { id?: string },
): Promise<AdviceSnapshot> {
  const row: AdviceSnapshot = {
    ...input,
    id: input.id ?? `adv_${nanoid(10)}`,
    createdAt: Date.now(),
  };
  // 一天只留一条：重算时覆盖旧结论，避免界面上出现两个互相矛盾的建议
  const old = await db.advices.where('date').equals(row.date).toArray();
  for (const o of old) await db.advices.delete(o.id);
  await db.advices.put(row);
  return row;
}

export async function dropAdvice(date: string): Promise<void> {
  const old = await db.advices.where('date').equals(date).toArray();
  for (const o of old) await db.advices.delete(o.id);
}
