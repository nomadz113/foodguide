/**
 * 库缺口（match miss）—— 让食物库按用户真实吃的东西长大。
 *
 * ## 它解决什么、不解决什么
 * **不解决微矿**：AI 给不出 13 项维生素矿物质，从这里补进库的条目微矿仍然是 null，
 * 下次拍同一道菜还是「—」。想补微量只有两条路：扩种子库，或让用户抄营养标签。
 *
 * 真正解决三件事：
 * 1. 份量记忆 —— 入册后 recordTierSample 才有样本可学，第二次点档位不是冷启动
 * 2. 别名纠正 —— 「大白菜」归到「白菜」，比新建一条准得多，而且库不会膨胀
 * 3. 搜得到 —— 手动记账时不用每次重填营养表
 *
 * ## 三条纪律
 * 1. **只记录，不写库**。这个模块不创建食物；入册必须人点一次（同铁律 3）。
 * 2. **统计失败绝不能拖垮记录**。recordMiss 全部 try/catch 吞掉 —— 为了攒一条统计
 *    而让「保存这一餐」失败，是本末倒置。
 * 3. **幂等**。主键是归一化名，多记一次只是 count+1，不会长出重复行。
 */

import { db } from '../db/schema';
import type { Food, MatchMiss, MissKind, MissStatus } from '../db/types';
import type { NutritionFacts } from '../nutrition/types';
import { facts } from '../nutrition/types';
import { findMatch, MATCH_MIN, similarity } from './match';
import { normalizeName } from './normalize';
import { roundGrams } from '../meal/grams';

/**
 * 做法词：命中即判为「菜品」。
 * 只收双字词 —— 单字（炒/炖/烤）会误伤「烤麸」「卤蛋」这类食材名。
 */
const DISH_MARKERS = [
  '红烧', '清炒', '爆炒', '小炒', '干煸', '干锅', '水煮', '糖醋', '蒜蓉', '蒜香',
  '麻婆', '鱼香', '京酱', '回锅', '凉拌', '干烧', '粉蒸', '椒盐', '香辣', '麻辣',
  '白灼', '清蒸', '酸辣', '宫保', '咖喱', '照烧', '黑椒', '茄汁',
];

/** 形态后缀：够长才算菜品（「面」「饭」两个字结尾的多半是一份现成主食） */
const DISH_SUFFIX = [
  '汤', '羹', '粥', '饭', '面', '粉', '饺', '包', '饼', '卷', '串', '锅', '煲',
  '沙拉', '汉堡', '披萨', '三明治', '盖饭', '拌面',
];

/**
 * 单个做法字：只在长度 ≥3 时才判菜品。
 *
 * 「番茄炒蛋」「土豆烧牛肉」这类中间带做法字的，双字词表（清炒/爆炒/红烧）盖不住，
 * 但它们确实都是菜。而长度限制保住了「烤麸」「卤蛋」这种两字食材名。
 */
const DISH_SINGLE = ['炒', '烧', '焖', '炖', '煎', '烤', '卤', '拌', '蒸'];

/**
 * 这个名字像「一道菜」还是「一种食材」。
 *
 * 为什么必须分：同名菜品每次做法不同（油、糖、勾芡都不一样），把它当食材存进库
 * 等于给未来的记录埋一个固定的错值；而且它本身含油盐，会污染「食材」口径。
 * 菜品的正解是让拍照识别把它拆开，不是入册。
 */
export function isDishName(name: string): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  if (DISH_MARKERS.some((w) => n.includes(w))) return true;
  // 两字名不谈菜品（「米饭」「面条」是主食条目，本来就在库里）
  if (n.length < 3) return false;
  if (DISH_SINGLE.some((w) => n.includes(w))) return true;
  return DISH_SUFFIX.some((w) => n.endsWith(w));
}

export interface MissInput {
  name: string;
  grams?: number | null;
  /** AI 给这盘菜的 per100g，只用于入册预填，不是营养事实 */
  per100g?: NutritionFacts | null;
  /** 当前库。传了才能做「已经能命中就别记了」的自愈判断 */
  foods?: readonly Food[];
  /** 弱命中：当时命中了这条，但一点微量都没补上 —— 大概率认错了 */
  near?: { name: string; score: number; matched: boolean } | null;
}

/**
 * 记录一次未命中。**永不抛异常**。
 *
 * 返回值只用于测试与调用方日志：
 * - `hit`：现在库里已经能命中（库刚扩过 / 别名已补），不记并顺手销账
 * - `skip`：名字太短或不合法，噪声不值得记
 * - `recorded`：已累加
 */
export async function recordMiss(input: MissInput): Promise<'hit' | 'skip' | 'recorded'> {
  try {
    const name = (input.name ?? '').trim();
    const nameKey = normalizeName(name);
    // 单字名（「虾」「油」）既没有 bigram 又极可能是识别碎片，记了只会污染清单
    if (nameKey.length < 2) return 'skip';

    // 自愈：库已经覆盖的写法不该出现在缺口清单里。补库/加别名之后这里自然销账，
    // 不需要用户手动清。
    if (input.foods?.length) {
      const hit = findMatch(name, input.foods);
      if (hit && hit.score >= MATCH_MIN) {
        const prev = await db.misses.get(nameKey);
        if (prev && prev.status === 'open') {
          await db.misses.update(nameKey, { status: 'added' });
        }
        return 'hit';
      }
    }

    const prev = await db.misses.get(nameKey);
    const now = Date.now();
    // 没命中时也存一条「最像的候选」：清单里能直接显示「可能是「白菜」」，
    // 用户点一下就变成加别名，比让他自己再搜一遍省事。
    const guess = input.near ?? (input.foods?.length
      ? (() => {
        const top = similarFoods(name, input.foods!, 1)[0];
        return top && top.score >= 0.45
          ? { name: top.name, score: top.score, matched: false }
          : null;
      })()
      : null);
    const grams = input.grams != null && Number.isFinite(input.grams)
      ? [...(prev?.grams ?? []), roundGrams(Number(input.grams))].slice(-10)
      : (prev?.grams ?? []);

    const row: MatchMiss = {
      nameKey,
      // 展示用最近一次的写法：用户怎么说，清单就怎么显示
      name,
      count: (prev?.count ?? 0) + 1,
      firstAt: prev?.firstAt ?? now,
      lastAt: now,
      grams,
      per100g: input.per100g ?? prev?.per100g ?? facts({}),
      near: guess ?? prev?.near ?? null,
      kind: isDishName(name) ? 'dish' : 'ingredient',
      // 用户点过「忽略」就尊重到底：只累加次数，不自动重开。
      // 不然他每吃一次就被弹一次，最后只能把整个功能关掉。
      status: prev?.status === 'dismissed' ? 'dismissed' : 'open',
    };
    await db.misses.put(row);
    return 'recorded';
  } catch {
    return 'skip';
  }
}

/** 库里最像的几条，给「可能是它的别名」提供候选（纯本地，不打 AI） */
export function similarFoods(
  name: string,
  foods: readonly Food[],
  n = 3,
): { id: string; name: string; score: number }[] {
  const q = normalizeName(name);
  if (!q) return [];
  const out: { id: string; name: string; score: number }[] = [];
  for (const f of foods) {
    let s = similarity(q, f.name);
    for (const a of [...(f.aliases ?? []), ...(f.userAliases ?? [])]) {
      const v = similarity(q, a);
      if (v > s) s = v;
    }
    if (s > 0.3) out.push({ id: f.id, name: f.name, score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

export interface MissFilter {
  status?: MissStatus;
  kinds?: MissKind[];
  minCount?: number;
}

/** 清单查询：出现次数降序，同次数按最近一次 */
export async function listMisses(f: MissFilter = {}): Promise<MatchMiss[]> {
  const status = f.status ?? 'open';
  let rows = await db.misses.where('status').equals(status).toArray();
  if (f.kinds?.length) {
    const set = new Set(f.kinds);
    rows = rows.filter((r) => set.has(r.kind));
  }
  if (f.minCount != null && f.minCount > 1) rows = rows.filter((r) => r.count >= f.minCount!);
  return rows.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

export async function setMissStatus(nameKey: string, status: MissStatus): Promise<void> {
  await db.misses.update(nameKey, { status });
}

export async function countOpenMisses(): Promise<number> {
  return db.misses.where('status').equals('open').count();
}

/**
 * 打开清单前跑一遍：把现在能命中的条目标成「已覆盖」。
 *
 * 为什么不在写入时就判定：写入那一刻的库是旧的。用户可能是三周后才补的种子库
 * 或者别名，那时候只有显示前重新算一次才能知道缺口补上了。
 */
export async function reconcileMisses(foods: readonly Food[]): Promise<number> {
  if (!foods.length) return 0;
  const open = await db.misses.where('status').equals('open').toArray();
  let closed = 0;
  for (const m of open) {
    const hit = findMatch(m.name, foods);
    if (hit && hit.score >= MATCH_MIN) {
      await db.misses.update(m.nameKey, { status: 'added' });
      closed += 1;
    }
  }
  return closed;
}

/** 克数中位数，入册时当默认份量（平均值会被一次「一大盆」带偏） */
export function medianGrams(grams: number[]): number | null {
  const xs = grams.filter((g) => Number.isFinite(g) && g > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

/**
 * 入册时预填的分类。
 *
 * 刻意不用 AI：分类只是个展示用标签，为它多打一次模型调用（要钱、要网、
 * 还会失败）不值当；关键词表的准确率在这种粗分类上不比模型差。
 * 顺序有讲究：水果在蛋白之前（「牛油果」含「牛」），奶类在蛋白之前（「牛奶」含「牛」）。
 */
const CATEGORY_RULES: [RegExp, string][] = [
  [/苹果|梨|桃|莓|橙|橘|柚|蕉|葡萄|西瓜|哈密瓜|甜瓜|木瓜|芒果|菠萝|荔枝|龙眼|石榴|猕猴桃|枣|柿|李|杏|枇杷|杨梅|樱桃|榴莲|火龙果|百香果|椰子|柠檬|牛油果/, '水果'],
  [/奶|酪|酸奶|芝士|黄油/, '奶类'],
  [/鱼|虾|蟹|贝|蛤|蛏|蚝|鱿|章鱼|海参|海带|紫菜|水产/, '蛋白'],
  [/鸡|鸭|鹅|猪|牛|羊|肉|排骨|肝|肚|肠|血|心|舌|蹄|骨|蛋/, '蛋白'],
  [/豆腐|腐竹|千张|素鸡|豆干|豆皮/, '蛋白'],
  [/坚果|核桃|腰果|花生|杏仁|瓜子|芝麻|开心果|榛子|松子/, '坚果'],
  [/菜|苗|笋|瓜|茄|椒|菇|菌|耳|藕|萝卜|葱|蒜|姜|韭|芹|菠|莴|藻|豆芽|豆角|豇豆|四季豆|毛豆|豌豆|扁豆/, '蔬菜'],
  [/米|面|粉|馍|馒|饼|燕麦|玉米|薯|芋|山药|糙|麦|粉丝|年糕/, '主食'],
  [/油|酱|醋|盐|糖|椒粉|料酒|蚝油/, '调味'],
];

export function guessCategory(name: string): string {
  const n = normalizeName(name);
  for (const [re, cat] of CATEGORY_RULES) if (re.test(n)) return cat;
  return '自定义';
}

export async function clearMisses(status: MissStatus = 'dismissed'): Promise<number> {
  const rows = await db.misses.where('status').equals(status).toArray();
  await db.misses.bulkDelete(rows.map((r) => r.nameKey));
  return rows.length;
}

/** 供测试与调试：不用 nameKey 也能查一条 */
export async function getMiss(name: string): Promise<MatchMiss | undefined> {
  return db.misses.get(normalizeName(name));
}
