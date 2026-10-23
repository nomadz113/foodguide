/**
 * 餐次构建与汇总。
 *
 * 关键：MealItem.nutrition 是「绝对量快照」，一旦写入就与食物库脱钩。
 * 之后用户改食物库、改档案、改目标，都不会篡改这条历史记录。
 */

import { nanoid } from 'nanoid';
import { aggregate, scaleFacts } from '../nutrition/calc';
import type { NutritionFacts, NutrientKey } from '../nutrition/types';
import type { MatchType, Meal, MealItem, MealSlot, PortionTier } from '../db/types';
import { tierFactor } from '../portion/tier';
import { dayKey, guessSlot } from '../date';

export interface DraftItem {
  name: string;
  per100g: NutritionFacts;
  /** AI 或食物库给的基准份（= 中份） */
  baseG: number;
  /** 显式指定克数（用户微调过），优先级高于档位倍率 */
  grams?: number;
  foodId?: string | null;
  matchType?: MatchType;
  matchScore?: number | null;
  /** 逐字段来源：宏量来自 AI、微量来自食物库时必须能追溯 */
  fieldSource?: MealItem['fieldSource'];
  gramSource?: MealItem['gramSource'];
  scaleDamp?: number;
  scaleFixed?: boolean;
  confidence?: number;
  components?: MealItem['components'];
  /** 复合菜拆解时归属的菜名 */
  parentDish?: string | null;
}

export function makeItem(d: DraftItem, tier: PortionTier = 'medium'): MealItem {
  const damp = d.scaleFixed ? 1 : (d.scaleDamp ?? 1);
  const grams = d.grams != null
    ? Math.max(0, Math.round(d.grams))
    : d.scaleFixed
      ? Math.round(d.baseG)
      : Math.round(d.baseG * tierFactor(tier, damp));

  return {
    id: `item_${nanoid(8)}`,
    name: d.name,
    rawName: null,
    parentDish: d.parentDish ?? null,
    foodId: d.foodId ?? null,
    matchType: d.matchType ?? 'manual',
    matchScore: d.matchScore ?? null,
    grams,
    baseG: Math.round(d.baseG),
    portionTier: d.scaleFixed ? null : tier,
    tierConfirmed: false,
    scaleDamp: d.scaleDamp,
    scaleFixed: d.scaleFixed,
    quantity: null,
    unit: null,
    gramSource: d.gramSource ?? 'user',
    per100g: { ...d.per100g },
    nutrition: scaleFacts(d.per100g, grams),
    fieldSource: d.fieldSource ?? {},
    components: d.components ?? null,
    confidence: d.confidence ?? 0.9,
    locked: false,
  };
}

/** 重建整餐（items 变更后必须调用，保证 totals 与 items 一致） */
export function retotalMeal(meal: Meal): Meal {
  const { totals, coverage } = aggregate(meal.items);
  return { ...meal, totals, coverage };
}

export interface MakeMealInput {
  items: MealItem[];
  slot?: MealSlot;
  source?: Meal['source'];
  eatenAt?: number;
  goalId?: string | null;
  photoId?: string | null;
  /** 归属日期（按 dayStartHour 切日），不传则按 eatenAt 推算 */
  date?: string;
}

export function makeMeal(input: MakeMealInput): Meal {
  const eatenAt = input.eatenAt ?? Date.now();
  const { totals, coverage } = aggregate(input.items);
  return {
    id: `meal_${nanoid(10)}`,
    date: input.date ?? dayKey(eatenAt),
    eatenAt,
    slot: input.slot ?? guessSlot(new Date(eatenAt)),
    source: input.source ?? 'manual',
    photoId: input.photoId ?? null,
    items: input.items,
    totals,
    coverage,
    goalId: input.goalId ?? null,
    aiMeta: null,
    createdAt: Date.now(),
    deletedAt: null,
  };
}

// ── 日汇总 ────────────────────────────────────────────────
export interface DayTotals {
  totals: NutritionFacts;
  coverage: Partial<Record<NutrientKey, number>>;
  totalGrams: number;
  mealCount: number;
  itemCount: number;
}

export function sumMeals(meals: Meal[]): DayTotals {
  const items = meals.flatMap((m) => m.items.map((it) => ({ grams: it.grams, nutrition: it.nutrition })));
  const { totals, coverage, totalGrams } = aggregate(items);
  return {
    totals,
    coverage,
    totalGrams,
    mealCount: meals.length,
    itemCount: items.length,
  };
}

/** 各餐次的热量分布，用于「早餐 420 · 午餐 650」这类展示 */
export function slotTotals(meals: Meal[]): Record<MealSlot, number> {
  const out: Record<MealSlot, number> = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  for (const m of meals) {
    const k = m.totals.kcal;
    if (typeof k === 'number') out[m.slot] += k;
  }
  return out;
}

export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐',
};
