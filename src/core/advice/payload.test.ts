import { describe, expect, it } from 'vitest';
import type { GoalSnapshot, Meal, Profile } from '../db/types';
import { facts } from '../nutrition/types';
import { makeItem, makeMeal } from '../meal/build';
import { buildAdvicePayload, SALT_LIMIT_G } from './payload';

const profile: Profile = {
  id: 'me', sex: 'male', birthDate: '1996-04-18', heightCm: 175, weightKg: 78,
  bodyFatPct: null, waistCm: null, activityLevel: 'light', exerciseTypes: [],
  exerciseDaysPerWeek: 2, goalType: 'lose', targetWeightKg: 68, paceKgPerWeek: 0.5,
  specialStates: [], conditions: [], allergies: [], dietPrefs: [], updatedAt: 0,
};

const goal: GoalSnapshot = {
  id: 'g1', effectiveFrom: '2026-01-01', sourceProfileHash: 'h', goalType: 'lose',
  startWeightKg: 78, targetWeightKg: 68, paceKgPerWeek: 0.5,
  bmr: 1700, tdee: 2400, kcalFloor: 1600, kcal: 1902, dailyDeficit: 498,
  proteinG: 131, fatG: 58, carbsG: 200, fiberG: 25, sodiumLimitMg: 2000, waterMl: 2500,
  micro: {}, projectedDays: 120, warnings: [], createdAt: 0,
};

function meal(name: string, grams: number, values: Record<string, number | null>): Meal {
  const per100g = facts(values);
  return makeMeal({
    items: [makeItem({ name, per100g, baseG: grams, grams })],
    date: '2026-10-22',
    slot: 'lunch',
  });
}

describe('建议输入构造', () => {
  it('缺口与剩余热量由公式算好，不让模型自己减', () => {
    // per100g：116 kcal / 2.6g 蛋白 -> 200g 合计 232 kcal / 5.2g
    const m = meal('米饭', 200, { kcal: 116, protein: 2.6, fiber: 0.3, sodium: 3 });
    const p = buildAdvicePayload({
      goal, totals: m.totals, coverage: m.coverage, meals: [m], profile, hour: 19,
    });
    expect(p.kcalTarget).toBe(1902);
    expect(p.kcalIntake).toBe(232);
    expect(p.remain).toBe(1670);
    expect(p.proteinGap).toBe(126);
    expect(p.saltLimitG).toBeCloseTo(Number(SALT_LIMIT_G.toFixed(1)), 5);
  });

  it('钠覆盖不足时不报盐量，并把它写进 dataNotes', () => {
    // 两条餐，只有一条带钠 -> 覆盖 50% 边缘以下需再低一些
    const withNa = meal('米饭', 100, { kcal: 116, sodium: 300 });
    const noNa = meal('鸡胸肉', 300, { kcal: 400 });
    const p = buildAdvicePayload({
      goal,
      totals: { ...withNa.totals },
      coverage: { sodium: 0.25 },
      meals: [withNa, noNa],
      profile,
      hour: 12,
    });
    expect(p.saltG).toBeNull();
    expect(p.dataNotes.join('')).toContain('钠数据不完整');
  });

  it('只记了一餐时明确告知，避免模型按三餐缺口给建议', () => {
    const m = meal('面', 300, { kcal: 500, protein: 15, fiber: 3 });
    const p = buildAdvicePayload({
      goal, totals: m.totals, coverage: m.coverage, meals: [m], profile, hour: 12,
    });
    expect(p.dataNotes.join('')).toContain('只记录了 1 餐');
  });

  it('每条餐次都带克数，模型不必猜份量', () => {
    const m = meal('米饭', 200, { kcal: 232 });
    const p = buildAdvicePayload({
      goal, totals: m.totals, coverage: m.coverage, meals: [m], profile, hour: 19,
    });
    expect(p.meals[0]!.items[0]).toBe('米饭 200g');
    expect(p.meals[0]!.slot).toBe('午餐');
  });
});
