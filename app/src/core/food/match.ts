/**
 * 食物库匹配 —— 用 Dice 系数在名称上找最像的库条目。
 *
 * ## 为什么需要这一步
 * 视觉模型稳定输出的只有 6 项：热量 / 蛋白 / 脂肪 / 碳水 / 纤维 / 钠。
 * 剩下 14 项（糖 + 13 项维生素矿物质）它给不出来，硬要它给就会瞎编。
 * 但它看「这是什么、多少克」很准。
 * 所以分工是：**AI 定份量与宏量，食物库定微量**。
 *
 * ## 三条纪律
 * 1. **只填空，不覆盖**。AI 给的宏量是「这盘菜」的值（含油盐），库里是「这种食材」的值，
 *    两者口径不同 —— 酱牛肉 246 kcal/100g 是对的，库里「牛肉」106 kcal 是生瘦肉，也对的。
 *    覆盖就会把准确的 AI 值换成错的值。
 * 2. **阈值 0.62，低于此值宁可不匹配**。填错比留空更糟：留空 UI 显示「—」，
 *    用户知道"这项没算"；填错用户会以为算过了。
 * 3. **可追溯**。返回命中的库名与分数，写进 MealItem.fieldSource，UI 要能说明来源。
 *
 * ## 为什么是 Dice + bigram，不是编辑距离
 * 中文食物名只有 2~4 字。编辑距离对「米饭 / 米粉」只差 1 个字符 → 相似度 0.5 甚至更高，
 * 会把米粉认成米饭。bigram 集合上一个共同项都没有 → 0 分，正确。
 * 同义词（面条↔挂面、香肠↔腊肠）不靠算法猜，靠 aliases 明写 —— 猜出来的一定不可靠。
 */

import { MICRO_KEYS, isKnown, type NutrientKey, type NutritionFacts } from '../nutrition/types';
import { normalizeName } from './normalize';

/** 低于这个分数宁可不匹配 */
export const MATCH_MIN = 0.62;

/**
 * 「弱命中」的上界：0.62~0.78 之间的命中多半是同一个大类里的兄弟（鸡胸↔鸡腿），
 * 用来填微量就是在猜。这里不拦（拦了会大面积退化），但要让反哺清单能看见它 ——
 * 错配比留空更糟，因为留空用户知道没算，错配他以为算过了。
 */
export const MATCH_WEAK = 0.78;

/** 只从库里补这些字段；宏量与钠由 AI 负责，口径不同不能混 */
export const FILL_KEYS: readonly NutrientKey[] = ['sugar', ...MICRO_KEYS];

function bigrams(s: string): string[] {
  if (s.length === 0) return [];
  if (s.length === 1) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function diceMultiset(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hit++;
      counts.set(g, c - 1);
    }
  }
  return (2 * hit) / (A.length + B.length);
}

/** 两个名字的相似度 0~1（内部已做归一化） */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const d = diceMultiset(x, y);
  // 单字名（"油""虾"）没有 bigram，只能退化成包含判断，且给个封顶值
  if (x.length < 2 || y.length < 2) {
    return Math.max(d, x.includes(y) || y.includes(x) ? 0.8 : 0);
  }
  return d;
}

export interface Matchable {
  name: string;
  aliases: string[];
  /** 用户自建别名（种子升级不覆盖），与 aliases 同等参与匹配 */
  userAliases?: string[];
  /** custom 100 / import 80 / preset 50 / ai 20 */
  priority?: number;
  usageCount?: number;
}

export interface MatchResult<T> {
  food: T;
  score: number;
  /** 命中的那个写法（主名或某个别名），用于向用户解释 */
  matchedOn: string;
}

/**
 * 在候选里找最佳匹配。
 * 同分时先比 priority（用户自建 > 导入 > 预置），再比 usageCount。
 */
export function findMatch<T extends Matchable>(
  query: string,
  list: readonly T[],
  min = MATCH_MIN,
): MatchResult<T> | null {
  const q = normalizeName(query);
  if (!q) return null;

  let best: MatchResult<T> | null = null;
  for (const food of list) {
    let score = similarity(q, food.name);
    let matchedOn = food.name;
    // aliases 与 userAliases 一视同仁：用户补的「大白菜」必须和种子里的别名一样好使
    for (const alias of [...(food.aliases ?? []), ...(food.userAliases ?? [])]) {
      const s = similarity(q, alias);
      if (s > score) {
        score = s;
        matchedOn = alias;
      }
    }
    if (score < min) continue;

    if (!best) {
      best = { food, score, matchedOn };
      continue;
    }
    // 分数差 > 0.05 时不让优先级翻盘，避免"用户存过同名条目"就把正确匹配挤掉
    const better = score > best.score + 0.05
      || (Math.abs(score - best.score) <= 0.05
        && (food.priority ?? 0) > (best.food.priority ?? 0));
    if (better) best = { food, score, matchedOn };
  }
  return best;
}

/**
 * 尾锚定兜底 —— 名字以库条目结尾时，认为那是「食材 + 做法前缀」。
 * 「无油煎鸡胸肉」→ 鸡胸肉，「香煎鸡胸」→ 鸡胸。
 *
 * ## 为什么需要它
 * Dice 对前缀是断崖式惩罚。query 比库名长 3 个字时，即使库名的 bigram 全部命中，
 * 也只有 2×2/(5+2)=0.571，永远够不到 0.62 —— 而「无油煎 / 空气炸 / 低脂水煮」
 * 这类 3~4 字前缀在中文口语里是常态。这类名字不是「另一种食物」，只是同一个食材加了做法。
 *
 * ## 为什么用尾锚定，不是简单包含
 * 中文构词是「定语 + 中心语」，做法永远在食材**前面**。要求 endsWith 能挡掉
 * 「鸡蛋灌饼」吃「鸡蛋」、「牛肉面」吃「牛肉」这类主体不是那个食材的情况。
 * 再加两道闸：库名 ≥2 字（单字会吃掉太多东西）、前缀 ≤4 字（挡「外婆做的老坛酸菜牛肉」）。
 *
 * ## 为什么只补微量
 * 尾锚定管得住「这是什么食材」，管不住「做成了什么」。库里鸡胸肉是生食材 133 kcal，
 * 用户吃的是无油煎熟制 165 kcal —— 整条换库值会把更准的数字换成错的。
 * 所以调用方拿到它只能喂 fillMicro，不能替换 per100g。
 *
 * 返回的 score 是「库名占 query 的比例」，只用于展示，与 MATCH_MIN 不是同一套语义。
 */
export function findSuffixMatch<T extends Matchable>(
  query: string,
  list: readonly T[],
  maxPrefix = 4,
): MatchResult<T> | null {
  const q = normalizeName(query);
  if (q.length < 3) return null;

  let best: MatchResult<T> | null = null;
  let bestLen = 0;
  for (const food of list) {
    for (const raw of [food.name, ...(food.aliases ?? []), ...(food.userAliases ?? [])]) {
      const n = normalizeName(raw);
      // 单字（「虾」「鱼」）做尾锚定会把半个词库都吃进去；同长说明是精确命中，归 findMatch 管
      if (n.length < 2 || q.length <= n.length) continue;
      if (q.length - n.length > maxPrefix) continue;
      if (!q.endsWith(n)) continue;
      // 最长命中优先：「鸡胸肉」必须压过「鸡胸」，否则会挑到短名字那条
      const better = n.length > bestLen
        || (n.length === bestLen && (food.priority ?? 0) > (best?.food.priority ?? 0));
      if (better) {
        best = { food, score: n.length / q.length, matchedOn: raw };
        bestLen = n.length;
      }
    }
  }
  return best;
}

export interface FillResult {
  per100g: NutritionFacts;
  /** 实际被填上的字段 */
  filled: NutrientKey[];
  /** 哪个字段来自哪条库食物（同一次调用只有一个来源，保留结构以便将来多源合并） */
  source: string | null;
  score: number;
}

/**
 * 把库里的微量补进 AI 的 per100g。
 *
 * 注意：这里**不**做生熟折算系数。AI 给的是入口状态，库给的是可食部原状，
 * 肉类熟制后微量元素会浓缩 1.2~1.5 倍 —— 这是已知的、方向明确的低估。
 * 与其乘一个拍脑袋的系数假装精确，不如如实保留并在 UI 标注「微量来自食物库参考」。
 */
export function fillMicro(
  aiPer100g: NutritionFacts,
  food: { name: string; per100g: NutritionFacts } | null,
  score = 0,
): FillResult {
  const out = { ...aiPer100g };
  const filled: NutrientKey[] = [];
  if (!food) return { per100g: out, filled, source: null, score };

  for (const k of FILL_KEYS) {
    if (isKnown(out[k])) continue;
    const v = food.per100g[k];
    if (!isKnown(v)) continue;
    out[k] = v;
    filled.push(k);
  }

  return { per100g: out, filled, source: filled.length ? food.name : null, score };
}

/**
 * 一步到位：按名称匹配 + 补微量。
 * 返回的 per100g 只保证"宏量是 AI 的、微量可能是库的"。
 */
export function matchAndFill<T extends Matchable & { per100g: NutritionFacts }>(
  name: string,
  aiPer100g: NutritionFacts,
  list: readonly T[],
): { per100g: NutritionFacts; match: MatchResult<T> | null; filled: NutrientKey[] } {
  const match = findMatch(name, list);
  const r = fillMicro(aiPer100g, match?.food ?? null, match?.score ?? 0);
  return { per100g: r.per100g, match, filled: r.filled };
}
