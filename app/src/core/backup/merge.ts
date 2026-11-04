/**
 * 导入时的合并规则 —— 全部是纯函数，不碰 IndexedDB，便于单独测。
 *
 * 总原则：**合并，不覆盖。**
 *
 * 覆盖是错的：用户在新入口可能已经记了两周，一份来自旧入口的备份不该把它们抹掉。
 * 但也不能「本地优先」——那样从旧手机导入备份等于什么都没做。
 * 所以逐表定规则，判据只有两个：谁更新（updatedAt / createdAt），以及什么不能丢。
 *
 * 「什么不能丢」最关键的是份量学习信号：usageCount、biasSamples、personalBias。
 * 那是用户一餐一餐点出来的，被一次导入抹成零等于白喂了三个月 ——
 * 所以这三个字段取**并集 / 较大值**，而不是取较新的一方。
 */

import type {
  AdviceSnapshot, ChatMessage, Food, GoalSnapshot, Meal, Profile, Settings, WeightEntry,
} from '../db/types';
import { learnBias } from '../portion/tier';

export interface MergeCounts {
  added: number;
  updated: number;
}

export interface MergeResult<T> extends MergeCounts {
  /** 需要写入的行（新增 + 被改动的），未变化的不写，保证幂等 */
  rows: T[];
}

const MAX_BIAS_SAMPLES = 20;

// ── 通用：按某个键合并，冲突时取较新（createdAt 更大）的一方 ──
function mergeByKey<T extends { createdAt: number }>(
  local: T[],
  incoming: T[],
  keyOf: (t: T) => string,
): MergeResult<T> {
  const map = new Map<string, T>();
  for (const l of local) map.set(keyOf(l), l);

  const rows: T[] = [];
  let added = 0;
  let updated = 0;

  for (const inc of incoming) {
    const k = keyOf(inc);
    const cur = map.get(k);
    if (!cur) {
      rows.push(inc);
      map.set(k, inc); // 同一份文件里也可能有重复键，后出现的算新增一次
      added++;
      continue;
    }
    if (inc.createdAt > cur.createdAt) {
      rows.push(inc);
      map.set(k, inc);
      updated++;
    }
    // createdAt 相等 → 内容就是同一条（幂等：导两次不会重复写）
  }
  return { rows, added, updated };
}

// ── 餐次 ──────────────────────────────────────────────────
/**
 * 按 id 合并。id 是 nanoid，跨 origin 也不会撞（除非是同一条记录被导来导去，
 * 那正是要合并的情况）。
 *
 * 软删的记录不特殊对待：备份里有、本地被删了，以备份为准恢复它 ——
 * 「我现在能看到这条记录」是用户对导入结果的直觉预期。
 */
export function mergeMeals(local: Meal[], incoming: Meal[]): MergeResult<Meal> {
  return mergeByKey(local, incoming, (m) => m.id);
}

// ── 食物 ──────────────────────────────────────────────────
/**
 * 按 [nameKey+source] 合并 —— **不是 id**。
 *
 * 原因写在这里因为反直觉：同一个自定义菜在两个 origin 里各有一个 nanoid id，
 * 「我家的米饭一碗 200 克」在 A 里是 food_abc、在 B 里是 food_xyz。
 * 按 id 合并会得到两条一模一样的菜，匹配时谁先命中全看运气。
 * 而 nameKey+source 正是 schema v2 的唯一索引，语义上就是「同一条菜」。
 */
export function mergeFoods(local: Food[], incoming: Food[]): MergeResult<Food> {
  const keyOf = (f: Food) => `${f.nameKey}@${f.source}`;
  const map = new Map<string, Food>();
  for (const l of local) map.set(keyOf(l), l);

  const rows: Food[] = [];
  let added = 0;
  let updated = 0;

  for (const inc of incoming) {
    const k = keyOf(inc);
    const cur = map.get(k);

    if (!cur) {
      rows.push(inc);
      map.set(k, inc);
      added++;
      continue;
    }

    // 学习信号取并集/较大值，不取「较新」：这两个入口的点击历史都是用户自己的
    const samples = mergeBiasSamples(cur, inc);
    // 没有样本时不要拿 learnBias 的默认值覆盖 —— 那是把已有偏置清零
    const bias = samples.length > 0 ? learnBias(samples).bias : Math.max(cur.personalBias ?? 1, inc.personalBias ?? 1);

    // 其余字段取较新的一方；updatedAt 也取较新，保证来回导不会来回跳
    const base = inc.updatedAt > cur.updatedAt ? inc : cur;
    const next: Food = {
      ...base,
      // id 保留本地的：meals.items[].foodId 指向的是本地那条，
      // 换成备份里的 id 会让已记录的餐次失去关联
      id: cur.id,
      usageCount: Math.max(cur.usageCount ?? 0, inc.usageCount ?? 0),
      lastUsedAt: Math.max(cur.lastUsedAt ?? 0, inc.lastUsedAt ?? 0) || null,
      biasSamples: samples.length > 0 ? samples : base.biasSamples,
      personalBias: bias,
      updatedAt: Math.max(cur.updatedAt, inc.updatedAt),
    };

    if (sameFood(cur, next)) continue; // 幂等：第二次导入不再写入
    rows.push(next);
    map.set(k, next);
    updated++;
  }

  return { rows, added, updated };
}

function mergeBiasSamples(a: Food, b: Food): { factor: number; at: number }[] {
  const seen = new Set<string>();
  const out: { factor: number; at: number }[] = [];
  for (const s of [...(a.biasSamples ?? []), ...(b.biasSamples ?? [])]) {
    if (!Number.isFinite(s?.factor) || !Number.isFinite(s?.at)) continue;
    const k = `${s.at}:${s.factor}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ factor: s.factor, at: s.at });
  }
  out.sort((x, y) => x.at - y.at);
  return out.slice(-MAX_BIAS_SAMPLES);
}

/** 只需判断"会不会真的改动"，避免每次导入都把全表重写一遍 */
function sameFood(a: Food, b: Food): boolean {
  return (
    a.usageCount === b.usageCount &&
    a.personalBias === b.personalBias &&
    a.updatedAt === b.updatedAt &&
    a.lastUsedAt === b.lastUsedAt &&
    (a.biasSamples?.length ?? 0) === (b.biasSamples?.length ?? 0) &&
    a.per100g.kcal === b.per100g.kcal &&
    a.name === b.name
  );
}

// ── 体重 ──────────────────────────────────────────────────
/** 一天一条，按 date 合并 */
export function mergeWeights(local: WeightEntry[], incoming: WeightEntry[]): MergeResult<WeightEntry> {
  return mergeByKey(local, incoming, (w) => w.date);
}

// ── 目标快照 ──────────────────────────────────────────────
export function mergeGoals(local: GoalSnapshot[], incoming: GoalSnapshot[]): MergeResult<GoalSnapshot> {
  return mergeByKey(local, incoming, (g) => g.id);
}

// ── 每日建议 ──────────────────────────────────────────────
/** 一天只留一条（和 saveAdvice 一致），按 date 合并 */
export function mergeAdvices(local: AdviceSnapshot[], incoming: AdviceSnapshot[]): MergeResult<AdviceSnapshot> {
  return mergeByKey(local, incoming, (a) => a.date);
}

// ── 聊天记录 ──────────────────────────────────────────────
/**
 * 按 id 去重后**整体重排时间戳**。
 *
 * 为什么必须重排：createdAt 单条递增是聊天可读性的地基 —— 同一毫秒发的消息
 * 若靠随机主键排序，界面上就是乱的。而两个 origin 的时间线各自递增，
 * 拼起来必然交叠。所以合并后统一做一遍 max(原值, 前一条+1) 的拉伸，
 * 代价是毫秒级的偏移，换来的是顺序永远正确。
 */
export function mergeChat(local: ChatMessage[], incoming: ChatMessage[]): MergeResult<ChatMessage> {
  const localIds = new Set(local.map((m) => m.id));
  const merged: ChatMessage[] = [...local];
  let added = 0;
  for (const inc of incoming) {
    if (localIds.has(inc.id)) continue;
    localIds.add(inc.id); // 同一份文件里也可能重名，只收一次
    merged.push(inc);
    added++;
  }

  merged.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  const rows: ChatMessage[] = [];
  let prev = -Infinity;
  let updated = 0;
  for (const m of merged) {
    const at = Math.max(m.createdAt, prev + 1);
    prev = at;
    const isNew = !local.some((l) => l.id === m.id);
    if (isNew) {
      rows.push(at === m.createdAt ? m : { ...m, createdAt: at });
    } else if (at !== m.createdAt) {
      rows.push({ ...m, createdAt: at });
      updated++;
    }
  }
  return { rows, added, updated };
}

// ── 档案 ──────────────────────────────────────────────────
/** 只有一条（id='me'），取较新的一方；本地没有就用备份的 */
export function pickProfile(
  local: Profile | null,
  incoming: Profile | null,
): { profile: Profile | null; changed: boolean } {
  if (!incoming) return { profile: null, changed: false };
  if (!local) return { profile: incoming, changed: true };
  if (incoming.updatedAt > local.updatedAt) return { profile: incoming, changed: true };
  return { profile: null, changed: false };
}

// ── 设置 ──────────────────────────────────────────────────
/**
 * 设置只搬「偏好」，不搬「版本状态」。
 *
 * **seedVersion 绝不导入**：它标记的是本地代码已经灌过哪版种子库。
 * 把旧设备的 6 搬进来，本地会在 ensureSeed 里直接跳过灌种子 ——
 * 而本地的种子库可能是空的（新 origin），于是内置食物一条都没有。
 *
 * **apiKeyCipher 只在本地没有 Key 时才导入**：换入口/换手机的目的就是「不用重填」，
 * 但本机已经填了一个新 Key 时不该被旧文件覆盖。
 */
export function pickSettings(
  local: Settings,
  incoming: Settings | null,
): { patch: Partial<Settings>; keyRestored: boolean } {
  if (!incoming) return { patch: {}, keyRestored: false };

  const patch: Partial<Settings> = {};
  for (const k of [
    'mode', 'provider', 'visionModel', 'textModel', 'jsonCapability',
    'imageMaxEdge', 'imageQuality', 'dayStartHour', 'autoPurgePhotosDays', 'categoryBias',
  ] as const) {
    const v = incoming[k];
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify(local[k])) {
      (patch as Record<string, unknown>)[k] = v;
    }
  }

  let keyRestored = false;
  if (!local.apiKeyCipher && incoming.apiKeyCipher) {
    patch.apiKeyCipher = incoming.apiKeyCipher;
    keyRestored = true;
  }
  return { patch, keyRestored };
}
