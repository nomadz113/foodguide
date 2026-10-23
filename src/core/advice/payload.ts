/**
 * 每日建议的输入构造（纯函数）。
 *
 * 单独一层的原因：喂给 AI 的每一个数字都必须是算好的、可复算的。
 * 把这些拼装逻辑留在页面里，就迟早会出现「页面显示还差 23g 蛋白、AI 说还差 30g」这种自相矛盾。
 */

import type { GoalSnapshot, Meal, Profile } from '../db/types';
import { SLOT_LABELS } from '../meal/build';
import { sodiumToSalt, isReliable } from '../nutrition/calc';
import { isKnown, type NutritionFacts } from '../nutrition/types';
import type { AdvicePayload } from '../ai/advice';
import { suggestActions } from './actions';

export interface AdviceInputs {
  goal: GoalSnapshot;
  totals: NutritionFacts;
  coverage: Partial<Record<keyof NutritionFacts, number>>;
  meals: Meal[];
  profile: Profile;
  hour: number;
}

const known = (v: number | null | undefined): number => (isKnown(v) ? (v as number) : 0);

/** 钠上限折算成盐：2000mg 钠 ≈ 5.08g 盐 */
export const SALT_LIMIT_G = sodiumToSalt(2000);

export function buildAdvicePayload(input: AdviceInputs): AdvicePayload {
  const { goal, totals, coverage, meals, profile, hour } = input;

  const kcal = known(totals.kcal);
  const protein = known(totals.protein);
  const fiber = known(totals.fiber);
  const sodium = known(totals.sodium);

  // 钠数据不可靠时不报盐量 —— 报一个偏低的数字比不报更危险（用户会以为不咸）
  const saltOk = sodium > 0 && isReliable(coverage, 'sodium');

  /**
   * 数据缺口由前端判定后写进 payload。
   * 模型看不到 coverage，让它自己判断「哪项数据不全」必然靠猜，
   * 而编出来的免责声明会直接损害可信度。
   */
  const dataNotes: string[] = [];
  if (!saltOk) dataNotes.push('钠数据不完整，盐量无法判断');
  if (!isReliable(coverage, 'fiber')) dataNotes.push('膳食纤维数据不完整');
  if (meals.length === 1) dataNotes.push('今天只记录了 1 餐');

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
    saltG: saltOk ? Number(sodiumToSalt(sodium).toFixed(1)) : null,
    saltLimitG: Number(SALT_LIMIT_G.toFixed(1)),
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
      saltG: saltOk ? sodiumToSalt(sodium) : null,
      saltLimitG: SALT_LIMIT_G,
      mealCount: meals.length,
    }),
    weightKg: profile.weightKg,
    targetWeightKg: goal.targetWeightKg,
    projectedDays: goal.projectedDays,
  };
}
