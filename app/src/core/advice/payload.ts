/**
 * 每日建议的输入构造（纯函数）。
 *
 * 单独一层的原因：喂给 AI 的每一个数字都必须是算好的、可复算的。
 * 把这些拼装逻辑留在页面里，就迟早会出现「页面显示还差 23g 蛋白、AI 说还差 30g」这种自相矛盾。
 */

import type { GoalSnapshot, Meal, Profile } from '../db/types';
import { SLOT_LABELS } from '../meal/build';
import { isReliable } from '../nutrition/calc';
import { isKnown, type NutritionFacts } from '../nutrition/types';
import type { AdvicePayload } from '../ai/advice';
import { suggestActions } from './actions';
import { computeTopSources, type TopSources } from './top';

export interface AdviceInputs {
  goal: GoalSnapshot;
  totals: NutritionFacts;
  coverage: Partial<Record<keyof NutritionFacts, number>>;
  meals: Meal[];
  profile: Profile;
  hour: number;
  /** 已算好的来源 TOP3；不传则按 meals 现算（页面与 payload 共用同一份结果） */
  top?: TopSources;
}

const known = (v: number | null | undefined): number => (isKnown(v) ? (v as number) : 0);

export function buildAdvicePayload(input: AdviceInputs): AdvicePayload {
  const { goal, totals, coverage, meals, profile, hour } = input;
  const top = input.top ?? computeTopSources(meals);

  const kcal = known(totals.kcal);
  const protein = known(totals.protein);
  const fiber = known(totals.fiber);

  /**
   * 数据缺口由前端判定后写进 payload。
   * 模型看不到 coverage，让它自己判断「哪项数据不全」必然靠猜，
   * 而编出来的免责声明会直接损害可信度。
   */
  const dataNotes: string[] = [];
  if (!isReliable(coverage, 'fiber')) dataNotes.push('膳食纤维数据不完整');
  if (meals.length === 1) dataNotes.push('今天只记录了 1 餐');
  // TOP3 数据不足也要说明：模型看不到 coverage，只能靠这个字段知道该不该闭嘴
  if (top.kcal.reason === 'coverage') dataNotes.push('热量来源数据不足，未列出 TOP3');
  if (top.fat.reason === 'coverage') dataNotes.push('脂肪来源数据不足，未列出 TOP3');

  return {
    goalType: profile.goalType,
    hour,
    kcalTarget: goal.kcal,
    kcalIntake: Math.round(kcal),
    remain: Math.round(goal.kcal - kcal),
    proteinTarget: goal.proteinG,
    proteinIntake: Math.round(protein),
    proteinGap: Math.round(goal.proteinG - protein),
    fiberTarget: goal.fiberG,
    fiberIntake: Math.round(fiber),
    fiberGap: Math.round(goal.fiberG - fiber),
    meals: meals.map((m) => ({
      slot: SLOT_LABELS[m.slot],
      kcal: Math.round(known(m.totals.kcal)),
      items: m.items.slice(0, 6).map((it) => `${it.name} ${Math.round(it.grams)}g`),
    })),
    dataNotes,
    suggestedActions: suggestActions({
      proteinGap: goal.proteinG - protein,
      fiberGap: goal.fiberG - fiber,
      remain: goal.kcal - kcal,
      kcalTarget: goal.kcal,
      mealCount: meals.length,
    }),
    weightKg: profile.weightKg,
    targetWeightKg: goal.targetWeightKg,
    projectedDays: goal.projectedDays,
    topSources: [
      { key: 'kcal', label: top.kcal.label, unit: top.kcal.unit, total: top.kcal.total, entries: top.kcal.entries },
      { key: 'fat', label: top.fat.label, unit: top.fat.unit, total: top.fat.total, entries: top.fat.entries },
    ],
  };
}
