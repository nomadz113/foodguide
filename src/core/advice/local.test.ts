import { describe, expect, it } from 'vitest';
import { localAdvice } from './local';
import type { GoalSnapshot } from '../db/types';

const goal: GoalSnapshot = {
  id: 'g1',
  effectiveFrom: '2026-10-22',
  sourceProfileHash: 'x',
  goalType: 'lose',
  startWeightKg: 78,
  targetWeightKg: 68,
  paceKgPerWeek: 0.5,
  bmr: 1729,
  tdee: 2377,
  kcalFloor: 1902,
  kcal: 1902,
  dailyDeficit: 475,
  proteinG: 131,
  fatG: 58,
  carbsG: 214,
  fiberG: 30,
  sodiumLimitMg: 2000,
  waterMl: 1700,
  micro: {},
  projectedDays: 162,
  warnings: [],
  createdAt: 0,
};

const base = { goal, kcal: 0, protein: 0, fiber: 0, mealCount: 0 };

describe('localAdvice', () => {
  it('没记录时提示先记一餐', () => {
    const a = localAdvice(base);
    expect(a.tone).toBe('empty');
    expect(a.headline).toContain('还没记录');
    expect(a.plan).toContain('131');
  });

  it('超出目标时不做「明天少吃」的负向引导', () => {
    const a = localAdvice({ ...base, kcal: 2100, protein: 120, fiber: 20, mealCount: 3 });
    expect(a.tone).toBe('over');
    expect(a.headline).toContain('超出');
    expect(a.body).not.toContain('明天少吃点');
  });

  it('蛋白差得多时给出可执行的补法', () => {
    const a = localAdvice({ ...base, kcal: 1000, protein: 60, fiber: 10, mealCount: 2 });
    expect(a.tone).toBe('behind');
    expect(a.headline).toContain('蛋白');
    expect(a.body).toMatch(/鸡胸肉|鸡蛋/);
  });

  it('蛋白已够、热量还剩很多时提醒补蔬菜', () => {
    const a = localAdvice({ ...base, kcal: 1200, protein: 135, fiber: 12, mealCount: 2 });
    expect(a.tone).toBe('behind');
    expect(a.body).toContain('蔬菜');
  });

  it('一切正常时给正向反馈', () => {
    // 蛋白差 11g（< 15 阈值），纤维差 4g（< 8 阈值）→ 不该再唠叨
    const a = localAdvice({ ...base, kcal: 1400, protein: 120, fiber: 26, mealCount: 3 });
    expect(a.tone).toBe('good');
    expect(a.headline).toContain('还可摄入');
  });

  it('文案里不出现无信息量的套话', () => {
    const tones = [
      localAdvice(base),
      localAdvice({ ...base, kcal: 2100, protein: 120, fiber: 20, mealCount: 3 }),
      localAdvice({ ...base, kcal: 1000, protein: 60, fiber: 10, mealCount: 2 }),
      localAdvice({ ...base, kcal: 1400, protein: 120, fiber: 26, mealCount: 3 }),
    ];
    for (const a of tones) {
      expect(a.body).not.toContain('营养均衡');
      expect(a.body).not.toContain('多运动');
      expect(a.body.length).toBeGreaterThan(10);
    }
  });
});
