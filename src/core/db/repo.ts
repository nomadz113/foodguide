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
  ChatMessage,
  Food, GoalSnapshot, Meal, PortionTier, Profile, Settings, WeightEntry,
} from './types';
import { buildGoalSnapshot, profileHash } from '../goal/engine';
import { normalizeName } from '../food/normalize';
import { SEED_FOODS, SEED_VERSION } from '../food/seed';
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
  seedVersion: 0,
  lastBackupAt: null,
  updatedAt: 0,
};

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
/** 灌入种子库。已存在则跳过，不覆盖用户改过的数据 */
export async function ensureSeed(): Promise<number> {
  const settings = await loadSettings();
  if (settings.seedVersion === SEED_VERSION) {
    const n = await db.foods.where('source').equals('preset').count();
    if (n > 0) return 0;
  }

  const now = Date.now();
  const rows: Food[] = SEED_FOODS.map((s) => ({
    id: s.id,
    name: s.name,
    nameKey: normalizeName(s.name),
    aliases: s.aliases,
    aliasKeys: s.aliases.map(normalizeName),
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

// ── 首次启动编排 ───────────────────────────────────────────
export async function bootstrap(): Promise<{ profile: Profile; goal: GoalSnapshot; seeded: number }> {
  const settings = await loadSettings();
  const day = dayKey(new Date(), settings.dayStartHour);
  const seeded = await ensureSeed();

  const existing = await loadProfile();
  const profile = existing ?? newProfile();
  if (!existing) {
    await db.profile.put(profile);
    // 首次启动就把档案里的体重记进体重表，趋势图从第一天就有起点
    await upsertWeight(day, profile.weightKg, profile.bodyFatPct);
  }

  const goal = await ensureGoal(profile, day);
  return { profile, goal, seeded };
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
