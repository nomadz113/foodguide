/**
 * 三档份量（小/中/大）—— 把「份量回归」降级成「三分类」。
 *
 * 为什么这么设计：
 * AI 给 237g 还是 251g 毫无意义（用户无法判断），但判断「这盘是小份/中份/大份」
 * 人类一秒就能做到。所以把不确定度锁进一个用户能一键纠正的区间，而不是假装精确。
 *
 * 两条纪律：
 * 1. 倍率对称（0.7 / 1.0 / 1.3），学习偏置的均值才有物理意义（无偏时 E[f]=1）。
 * 2. 只有「用户真的点过档位」才算学习样本。默认中份是「没表态」，不是「AI 对了」。
 */

import type { NutritionFacts } from '../nutrition/types';
import { NUTRIENT_KEYS, isKnown } from '../nutrition/types';
import { scaleFacts } from '../nutrition/calc';
import type { MealItem, PortionTier, TierSample } from '../db/types';
export type { TierSample };

// ── 倍率 ──────────────────────────────────────────────────
export const TIER_FACTOR: Record<PortionTier, number> = {
  small: 0.7,
  medium: 1,
  large: 1.3,
};

export const TIER_LABELS: Record<PortionTier, string> = {
  small: '小份',
  medium: '中份',
  large: '大份',
};

/** 烹调油的份量敏感度：锅里的油取决于做法，不随菜量严格线性 */
export const SEASONING_DAMP = 0.5;

/** 名字里带这些字的视为油/调味料，默认阻尼缩放 */
const SEASONING_HINTS = ['油', '糖', '酱', '淀粉', '料酒', '盐', '醋'];

export function looksLikeSeasoning(name: string): boolean {
  return SEASONING_HINTS.some((h) => name.includes(h));
}

/**
 * 档位的实际倍率。
 * damp=1 线性；damp=0.5 表示只走一半（油：小份 0.85 / 大份 1.15）。
 */
export function tierFactor(tier: PortionTier, damp = 1): number {
  const d = Math.min(1, Math.max(0, damp));
  return 1 + (TIER_FACTOR[tier] - 1) * d;
}

/** 该条目适用的阻尼：显式设置优先，否则按名字猜 */
function dampOf(item: Pick<MealItem, 'name' | 'scaleDamp'>): number {
  if (typeof item.scaleDamp === 'number') return item.scaleDamp;
  return looksLikeSeasoning(item.name) ? SEASONING_DAMP : 1;
}

/** 由基准份算出目标克数，取整到 1g（展示层再决定怎么圆） */
export function tierGrams(baseG: number, tier: PortionTier, damp = 1): number {
  const g = Math.max(0, baseG) * tierFactor(tier, damp);
  return Math.round(g);
}

// ── 单条缩放 ──────────────────────────────────────────────
export interface TierApplyResult {
  item: MealItem;
  /** 实际生效的倍率，供 UI 显示「×1.3」 */
  factor: number;
  /** 未缩放的原因，null 表示已缩放 */
  skipped: 'locked' | 'fixed' | null;
}

/**
 * 把某条记录切到指定档位。
 * 克数从 baseG 重算（不是从当前 grams 乘），避免连续切档累积误差。
 */
export function applyTier(item: MealItem, tier: PortionTier): TierApplyResult {
  if (item.locked) return { item, factor: 1, skipped: 'locked' };
  if (item.scaleFixed) return { item, factor: 1, skipped: 'fixed' };

  const damp = dampOf(item);
  const factor = tierFactor(tier, damp);
  const grams = tierGrams(item.baseG, tier, damp);

  return {
    item: {
      ...item,
      grams,
      portionTier: tier,
      gramSource: item.gramSource === 'library' ? 'library' : 'user',
      nutrition: rescale(item.per100g, grams, item.nutrition, item.grams),
    },
    factor,
    skipped: null,
  };
}

/** 整餐切换档位 */
export function applyTierToItems(items: MealItem[], tier: PortionTier): MealItem[] {
  return items.map((it) => applyTier(it, tier).item);
}

/**
 * 按 per100g 重算快照。
 * per100g 里本就缺失、但旧快照里有的字段（例如用户手填过），按克数比例沿用，不打下 null。
 */
function rescale(
  per100g: NutritionFacts,
  grams: number,
  prev: NutritionFacts,
  prevGrams: number,
): NutritionFacts {
  const next = scaleFacts(per100g, grams);
  if (prevGrams > 0) {
    const ratio = grams / prevGrams;
    for (const k of NUTRIENT_KEYS) {
      const cur = next[k];
      const old = prev[k];
      if (!isKnown(cur) && isKnown(old)) next[k] = old * ratio;
    }
  }
  return next;
}

// ── 个人偏置学习 ──────────────────────────────────────────
export interface BiasResult {
  /** 建议施加的倍率，未达门槛时为 1 */
  bias: number;
  /** 有效样本量（指数衰减后） */
  nEff: number;
  /** 收缩前的原始均值 */
  raw: number;
  /** 是否达到应用门槛 */
  applied: boolean;
}

/** 少于 3 次真实选择不学习 */
export const BIAS_MIN_SAMPLES = 3;
/** 收缩系数：样本越少越贴近 1 */
export const BIAS_SHRINK_K = 3;
/** 单次学习最多纠 ±25%，更大的系统性误差靠多轮迭代收敛 */
export const BIAS_MIN = 0.8;
export const BIAS_MAX = 1.25;
/** 半衰期 45 天：口味和食量会变，旧样本不该永久主导 */
export const BIAS_HALF_LIFE_DAYS = 45;

const DAY_MS = 86_400_000;
const NEUTRAL = 1;
/**
 * 浮点容差。nEff 是衰减权重之和，3 条当天样本会算出 2.9999999994，
 * 直接比较 >= 3 会判假 —— 门槛比较必须带容差。
 */
const EPS = 1e-6;

/**
 * 由历史档位选择算出该食物的个人偏置。
 *
 * bias = clamp( 1 + (加权均值 − 1) × n/(n+K) )
 *
 * 收缩是必需的：用户点了两次「大份」不该立刻把基准抬高 30%，
 * 那会让下一餐反过来偏多，来回震荡。
 */
export function learnBias(samples: TierSample[], now = Date.now()): BiasResult {
  const valid = samples.filter((s) => Number.isFinite(s.factor) && s.factor > 0);

  let wSum = 0;
  let wf = 0;
  for (const s of valid) {
    const ageDays = Math.max(0, (now - s.at) / DAY_MS);
    const w = 0.5 ** (ageDays / BIAS_HALF_LIFE_DAYS);
    wSum += w;
    wf += w * s.factor;
  }

  const nEff = wSum;
  const raw = wSum > 0 ? wf / wSum : NEUTRAL;
  const shrink = nEff / (nEff + BIAS_SHRINK_K);
  const shrunk = NEUTRAL + (raw - NEUTRAL) * shrink;
  const applied = nEff >= BIAS_MIN_SAMPLES - EPS && Math.abs(shrunk - NEUTRAL) >= 0.01;

  return {
    bias: applied ? clamp(shrunk, BIAS_MIN, BIAS_MAX) : NEUTRAL,
    nEff,
    raw,
    applied,
  };
}

/** 把偏置作用到 AI 新给的基准份上（只作用于新鲜识别结果，不可重复叠加） */
export function withBias(baseG: number, bias: number): number {
  if (!Number.isFinite(bias) || bias <= 0) return Math.round(baseG);
  return Math.max(1, Math.round(baseG * bias));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
