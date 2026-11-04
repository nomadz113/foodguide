/**
 * 本地规则建议（P1 阶段）。
 *
 * 刻意不接 AI：先把「目标 vs 实际」的差距算准，文案由公式推出来。
 * P4 会换成 AI 生成，但保留同样的输出结构，届时只需替换实现。
 * 现在每句话都能追溯到具体数字，不做「注意营养均衡」这类无信息量的废话。
 */

import type { GoalSnapshot } from '../db/types';

export type AdviceTone = 'empty' | 'good' | 'over' | 'behind';

export interface LocalAdvice {
  tone: AdviceTone;
  headline: string;
  body: string;
  plan: string;
}

export interface AdviceInput {
  kcal: number;
  protein: number;
  fiber: number;
  mealCount: number;
  goal: GoalSnapshot;
}

/** 常见高蛋白食物的单位蛋白成本，用于把「还差 23g 蛋白」翻译成可执行的话 */
const PROTEIN_SOURCES: { name: string; per100: number }[] = [
  { name: '鸡胸肉', per100: 19.4 },
  { name: '鸡蛋', per100: 13.3 },
  { name: '豆腐', per100: 12.2 },
  { name: '牛奶', per100: 3.3 },
];

function round(n: number): number {
  return Math.round(n);
}

function proteinHint(gapG: number): string {
  const pick = PROTEIN_SOURCES[0];
  const grams = Math.round((gapG / (pick?.per100 ?? 19.4)) * 100 / 5) * 5;
  const eggs = Math.round(gapG / 6.65);

  // 缺口太大时不要甩出一个「530g 鸡胸肉」这种一顿吃不下的数字
  if (gapG > 40) {
    return '一顿补不完，剩下几餐各加一份蛋白（150g 鸡肉 / 200g 豆腐 / 2 个鸡蛋）';
  }
  if (eggs <= 4 && eggs >= 1) return `约 ${grams}g 鸡胸肉，或 ${eggs} 个鸡蛋`;
  return `约 ${grams}g 鸡胸肉，或 ${Math.round(grams / 2)}g 豆腐`;
}

export function localAdvice(input: AdviceInput): LocalAdvice {
  const { kcal, protein, fiber, mealCount, goal } = input;
  const remain = goal.kcal - kcal;
  const proteinGap = goal.proteinG - protein;
  const fiberGap = goal.fiberG - fiber;

  const plan = `蛋白 ${goal.proteinG}g · 脂肪 ${goal.fatG}g · 碳水 ${goal.carbsG}g`;

  if (mealCount === 0) {
    return {
      tone: 'empty',
      headline: '今天还没记录',
      body: `目标 ${goal.kcal.toLocaleString()} kcal。记下第一餐，热量环才会动起来；漏记一顿的量，后面的判断就都偏了。`,
      plan,
    };
  }

  if (remain < -50) {
    return {
      tone: 'over',
      headline: `已超出 ${Math.abs(round(remain))} kcal`,
      body: proteinGap > 0
        ? `超出不多的话不用补救。但要留意蛋白还差 ${round(proteinGap)}g——明天优先补蛋白，别再靠主食和油凑热量。`
        : '今天到这里就好。明天不必刻意少吃来"补偿"，那会让记录失真，缺口反而算不准。',
      plan,
    };
  }

  if (proteinGap > 15) {
    return {
      tone: 'behind',
      headline: `还可摄入 ${round(remain)} kcal，但蛋白还差 ${round(proteinGap)}g`,
      body: `优先用高蛋白低热量的组合补齐：${proteinHint(proteinGap)}。蛋白吃够了，同样的热量更抗饿、也更保肌肉。`,
      plan,
    };
  }

  if (fiberGap > 8 && remain > 150) {
    return {
      tone: 'behind',
      headline: `还可摄入 ${round(remain)} kcal，纤维差 ${round(fiberGap)}g`,
      body: `热量不缺，缺的是蔬菜。加一份深色叶菜或一份水果，比再吃一份主食更划算。`,
      plan,
    };
  }

  return {
    tone: 'good',
    headline: `还可摄入 ${round(remain)} kcal`,
    body: proteinGap <= 0
      ? '蛋白质已达标，剩下这点空间随便安排，不必精确到克。'
      : `蛋白还差 ${round(proteinGap)}g，可以在下一餐补上。整体节奏没问题。`,
    plan,
  };
}
