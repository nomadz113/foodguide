/**
 * 营养计算纯函数。无副作用、无 IO，全部可被 vitest 直接测。
 *
 * 三条不可违反的规则：
 * 1. null ≠ 0 —— 未知营养素不参与累加、不参与达标判断。
 * 2. 缩放唯一公式 out = per100g × grams / 100。
 * 3. 取整只发生在展示层。
 */

import {
  KCAL_PER_GRAM, MACRO_KEYS, NUTRIENT_KEYS,
  type MacroKey, type NutrientKey, type NutritionFacts, emptyFacts, isKnown,
} from './types';

/** 取整到指定小数位（仅展示用） */
export function roundTo(v: number, digits = 1): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

/** 按克数缩放 per100g 数据；null 保持 null */
export function scaleFacts(per100g: NutritionFacts, grams: number): NutritionFacts {
  const factor = grams / 100;
  const out = emptyFacts();
  for (const k of NUTRIENT_KEYS) {
    const v = per100g[k];
    out[k] = isKnown(v) ? v * factor : null;
  }
  return out;
}

/** 由绝对量反推 per100g（用于改份量时按比例联动） */
export function toPer100g(absolute: NutritionFacts, grams: number): NutritionFacts {
  if (grams <= 0) return emptyFacts();
  return scaleFacts(absolute, 10000 / grams);
}

export interface TotalsResult {
  /** 累加值：未知按 0 计入，仅用于展示 */
  totals: NutritionFacts;
  /** 各营养素的覆盖率 0~1（按克重加权），用于决定是否显示「—」 */
  coverage: Partial<Record<NutrientKey, number>>;
  /** 总克重 */
  totalGrams: number;
}

/**
 * 汇总一组含克重的条目。
 * coverage[k] = 已知 k 的条目克重 / 总克重
 */
export function aggregate(items: { grams: number; nutrition: NutritionFacts }[]): TotalsResult {
  const totals = emptyFacts();
  const knownGrams = {} as Record<NutrientKey, number>;
  for (const k of NUTRIENT_KEYS) { totals[k] = 0; knownGrams[k] = 0; }

  let totalGrams = 0;
  for (const it of items) {
    const g = Math.max(0, it.grams);
    totalGrams += g;
    for (const k of NUTRIENT_KEYS) {
      const v = it.nutrition[k];
      if (!isKnown(v)) continue;
      totals[k] = (totals[k] as number) + v;
      knownGrams[k] += g;
    }
  }

  const coverage: Partial<Record<NutrientKey, number>> = {};
  for (const k of NUTRIENT_KEYS) {
    coverage[k] = totalGrams > 0 ? knownGrams[k] / totalGrams : 0;
    // 一项数据都没有 -> 该营养素不显示数值
    if (knownGrams[k] === 0) totals[k] = null;
  }

  return { totals, coverage, totalGrams };
}

/** 覆盖率不足时，该营养素不应计入达标分母 */
export const COVERAGE_MIN = 0.5;

export function isReliable(coverage: Partial<Record<NutrientKey, number>>, k: NutrientKey): boolean {
  return (coverage[k] ?? 0) >= COVERAGE_MIN;
}

/** 由三大宏量反推热量 */
export function kcalFromMacros(f: NutritionFacts): number | null {
  let sum = 0;
  let any = false;
  for (const k of MACRO_KEYS) {
    const v = f[k];
    if (!isKnown(v)) continue;
    sum += v * KCAL_PER_GRAM[k as MacroKey];
    any = true;
  }
  return any ? sum : null;
}

/**
 * 能量守恒自检：|热量 − 宏量推算热量| / 热量。
 * 超过 15% 说明某项估错，prompt 里要求模型重算。
 */
export function kcalDrift(f: NutritionFacts): number | null {
  if (!isKnown(f.kcal) || f.kcal <= 0) return null;
  const derived = kcalFromMacros(f);
  if (derived === null) return null;
  return Math.abs(f.kcal - derived) / f.kcal;
}

export const KCAL_DRIFT_LIMIT = 0.15;

/** 达标率：0~2+，null 表示不可判定 */
export function attainment(value: number | null, target: number | null): number | null {
  if (!isKnown(value) || !isKnown(target) || target <= 0) return null;
  return value / target;
}

/** 钠换算成食盐克数（钠 mg × 2.54 / 1000） */
export function sodiumToSalt(sodiumMg: number): number {
  return (sodiumMg * 2.54) / 1000;
}

export type MacroSource = 'library' | 'ai' | 'manual';

export interface MacroDisplay {
  key: MacroKey;
  label: string;
  value: number;
  target: number | null;
  ratio: number | null;
  /** 还差多少，负数表示超出 */
  remaining: number | null;
}

export const MACRO_LABELS: Record<MacroKey, string> = {
  protein: '蛋白质', fat: '脂肪', carbs: '碳水',
};

export function macroDisplay(
  totals: NutritionFacts,
  targets: Partial<Record<MacroKey, number | null>>,
): MacroDisplay[] {
  return MACRO_KEYS.map((key) => {
    const raw = totals[key];
    const value = isKnown(raw) ? raw : 0;
    const target = targets[key] ?? null;
    return {
      key,
      label: MACRO_LABELS[key as MacroKey],
      value,
      target,
      ratio: attainment(value, target),
      remaining: isKnown(target) ? target - value : null,
    };
  });
}
