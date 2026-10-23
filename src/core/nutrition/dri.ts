/**
 * 中国居民膳食营养素参考摄入量（DRIs 2023）成年人参考值。
 * 只做成人段（18~49 岁轻体力），≥50 岁调整钙；孕期/哺乳期仅做少量覆盖并在 UI 提示遵医嘱。
 *
 * 注意：钠是唯一「上限型」指标（<2000mg），不是达标目标。
 */

import type { NutritionFacts } from './types';

export type Sex = 'male' | 'female';

export interface DriProfile {
  /** 能量需要量 EER（仅在未设定减脂/增肌目标时使用） */
  eer: number;
  /** 蛋白质 RNI */
  protein: number;
  /** 膳食纤维 AI */
  fiber: number;
  /** 钠上限 */
  sodiumLimit: number;
  micro: Partial<NutritionFacts>;
  /** 可耐受最高摄入量，用于超标提示 */
  ul: Partial<NutritionFacts>;
}

const BASE_UL: Partial<NutritionFacts> = {
  calcium: 2000, iron: 42, zinc: 40, selenium: 400,
  va: 3000, vc: 2000, vd: 50, ve: 700, niacin: 35, sodium: 2000,
};

export const DRI_ADULT: Record<Sex, DriProfile> = {
  male: {
    eer: 2250,
    protein: 65,
    fiber: 25,
    sodiumLimit: 2000,
    micro: {
      calcium: 800, iron: 12, zinc: 12.5, selenium: 60, magnesium: 330,
      potassium: 2000, va: 800, vc: 100, vd: 10, ve: 14,
      b1: 1.4, b2: 1.4, niacin: 15,
    },
    ul: BASE_UL,
  },
  female: {
    eer: 1800,
    protein: 55,
    fiber: 25,
    sodiumLimit: 2000,
    micro: {
      calcium: 800, iron: 18, zinc: 8.5, selenium: 60, magnesium: 330,
      potassium: 2000, va: 700, vc: 100, vd: 10, ve: 14,
      b1: 1.2, b2: 1.2, niacin: 12,
    },
    ul: BASE_UL,
  },
};

/** 孕期 / 哺乳期覆盖值（叶酸不在 19 项内，UI 需提示遵医嘱） */
const PREGNANCY_OVERRIDE: Partial<NutritionFacts> = { iron: 24, calcium: 800, va: 770 };
const LACTATION_OVERRIDE: Partial<NutritionFacts> = { iron: 29, calcium: 800, va: 1300 };

export type SpecialState = 'pregnant' | 'lactating' | 'elderly' | 'chronic';

export interface DriQuery {
  sex: Sex;
  ageYears: number;
  states?: SpecialState[];
}

export function driFor({ sex, ageYears, states = [] }: DriQuery): DriProfile {
  const base = DRI_ADULT[sex];
  const micro: Partial<NutritionFacts> = { ...base.micro };
  let eer = base.eer;

  // ≥50 岁钙需求上调到 1000mg
  if (ageYears >= 50) micro.calcium = 1000;

  if (states.includes('pregnant')) {
    Object.assign(micro, PREGNANCY_OVERRIDE);
    eer = base.eer + 300;
  }
  if (states.includes('lactating')) {
    Object.assign(micro, LACTATION_OVERRIDE);
    eer = base.eer + 500;
  }

  return { ...base, eer, micro };
}

/** 表格用的展示顺序与样式 */
export const DRI_DISPLAY_KEYS = [
  'calcium', 'iron', 'zinc', 'selenium', 'potassium', 'magnesium',
  'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin',
] as const;
