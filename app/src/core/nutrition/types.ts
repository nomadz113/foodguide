/**
 * 营养素字段定义 —— 全项目唯一真相。
 * 约定：null 表示「未知」，绝不等于 0。这个区分是整个营养计算正确性的地基。
 */

export const NUTRIENT_KEYS = [
  'kcal',
  'protein', 'fat', 'carbs', 'fiber', 'sugar',
  'sodium', 'potassium', 'calcium', 'iron', 'zinc', 'selenium', 'magnesium',
  'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export type NutritionFacts = Record<NutrientKey, number | null>;

/** 三大宏量（提供热量） */
export const MACRO_KEYS = ['protein', 'fat', 'carbs'] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

/** 微量：维生素 + 矿物质 */
export const MICRO_KEYS = [
  'calcium', 'iron', 'zinc', 'selenium', 'potassium', 'magnesium',
  'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin',
] as const;
export type MicroKey = (typeof MICRO_KEYS)[number];

/** 展示用中文名 */
export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  kcal: '热量',
  protein: '蛋白质', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sugar: '糖',
  sodium: '钠', potassium: '钾', calcium: '钙', iron: '铁', zinc: '锌',
  selenium: '硒', magnesium: '镁',
  va: '维生素A', vc: '维生素C', vd: '维生素D', ve: '维生素E',
  b1: '维生素B1', b2: '维生素B2', niacin: '烟酸',
};

/** 单位（展示用） */
export const NUTRIENT_UNITS: Record<NutrientKey, string> = {
  kcal: 'kcal',
  protein: 'g', fat: 'g', carbs: 'g', fiber: 'g', sugar: 'g',
  sodium: 'mg', potassium: 'mg', calcium: 'mg', iron: 'mg', zinc: 'mg',
  selenium: 'μg', magnesium: 'mg',
  va: 'μgRAE', vc: 'mg', vd: 'μg', ve: 'mgα-TE',
  b1: 'mg', b2: 'mg', niacin: 'mgNE',
};

/** 每克提供的热量：蛋白质 4、碳水 4、脂肪 9 */
export const KCAL_PER_GRAM: Record<MacroKey, number> = {
  protein: 4, carbs: 4, fat: 9,
};

export function emptyFacts(): NutritionFacts {
  const out = {} as NutritionFacts;
  for (const k of NUTRIENT_KEYS) out[k] = null;
  return out;
}

export function facts(partial: Partial<NutritionFacts>): NutritionFacts {
  return { ...emptyFacts(), ...partial };
}

export function isKnown(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
