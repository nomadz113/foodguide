import { describe, expect, it } from 'vitest';
import { makeItem, makeMeal, retotalMeal, slotTotals, sumMeals } from './build';
import { facts } from '../nutrition/types';
import type { DraftItem } from './build';

const rice: DraftItem = {
  name: '米饭',
  per100g: facts({ kcal: 116, protein: 2.6, fat: 0.3, carbs: 25.9, fiber: 0.3 }),
  baseG: 150,
  foodId: 'preset_001',
  matchType: 'library',
  gramSource: 'library',
};

const oil: DraftItem = {
  name: '大豆油',
  per100g: facts({ kcal: 899, fat: 99.9 }),
  baseG: 10,
  scaleDamp: 0.5,
};

describe('makeItem', () => {
  it('中份等于基准份', () => {
    const it = makeItem(rice);
    expect(it.grams).toBe(150);
    expect(it.nutrition.kcal).toBeCloseTo(174, 6);
  });

  it('大份按 1.3 缩放', () => {
    const it = makeItem(rice, 'large');
    expect(it.grams).toBe(195);
    expect(it.portionTier).toBe('large');
    expect(it.tierConfirmed).toBe(false);
  });

  it('显式克数优先于档位', () => {
    const it = makeItem({ ...rice, grams: 173 }, 'large');
    expect(it.grams).toBe(173);
    expect(it.nutrition.kcal).toBeCloseTo(200.68, 1);
  });

  it('油按阻尼缩放，调味料保留小数', () => {
    // 11.5 / 8.5 都 <20g，走「调味料留 1 位小数」；取整成 12 / 9 就是 +4%~6% 的油
    expect(makeItem(oil, 'large').grams).toBe(11.5);
    expect(makeItem(oil, 'small').grams).toBe(8.5);
  });

  it('零点几克的盐不会被抹成整数', () => {
    const salt: DraftItem = {
      name: '食盐',
      per100g: facts({ kcal: 0, sodium: 39311 }),
      baseG: 0.5,
      gramSource: 'ai',
    };
    const it = makeItem(salt);
    expect(it.grams).toBe(0.5);
    expect(it.baseG).toBe(0.5);
    // 抹成 1g 会凭空多出 196mg 钠
    expect(it.nutrition.sodium).toBeCloseTo(196.6, 1);
  });

  it('未知营养素保持 null', () => {
    const it = makeItem(rice);
    expect(it.nutrition.vd).toBeNull();
    expect(it.nutrition.sodium).toBeNull();
  });
});

describe('makeMeal', () => {
  it('汇总与 coverage 一致', () => {
    const items = [makeItem(rice), makeItem(oil)];
    const meal = makeMeal({ items, slot: 'lunch', source: 'manual', date: '2026-10-22' });
    expect(meal.date).toBe('2026-10-22');
    expect(meal.slot).toBe('lunch');
    expect(meal.totals.kcal).toBeCloseTo(174 + 89.9, 1);
    // 油没有蛋白数据 → 蛋白覆盖率不到 100%
    expect(meal.coverage.protein).toBeCloseTo(150 / 160, 4);
  });

  it('不传日期时按 eatenAt 推算', () => {
    const at = new Date('2026-10-22T12:05:00').getTime();
    const meal = makeMeal({ items: [makeItem(rice)], eatenAt: at });
    expect(meal.date).toBe('2026-10-22');
    expect(meal.slot).toBe('lunch');
  });
});

describe('sumMeals', () => {
  it('多餐累加，空列表不崩', () => {
    const a = makeMeal({ items: [makeItem(rice)], date: '2026-10-22' });
    const b = makeMeal({ items: [makeItem(rice, 'large')], date: '2026-10-22' });
    const s = sumMeals([a, b]);
    expect(s.mealCount).toBe(2);
    expect(s.itemCount).toBe(2);
    expect(s.totalGrams).toBe(345);

    const empty = sumMeals([]);
    expect(empty.mealCount).toBe(0);
    expect(empty.totals.kcal).toBeNull(); // 没有任何数据 -> null 而非 0
  });

  it('累计多餐后 coverage 上升', () => {
    const a = makeMeal({ items: [makeItem(rice)], date: '2026-10-22' });
    const b = makeMeal({ items: [makeItem(oil)], date: '2026-10-22' });
    const s = sumMeals([a, b]);
    expect(s.coverage.kcal).toBe(1);
    expect(s.coverage.protein).toBeLessThan(1);
  });
});

describe('retotalMeal', () => {
  it('改条目后重算总量', () => {
    const meal = makeMeal({ items: [makeItem(rice)], date: '2026-10-22' });
    const bigger = { ...meal, items: [makeItem(rice, 'large')] };
    expect(retotalMeal(bigger).totals.kcal).toBeCloseTo(226.2, 1);
  });
});

describe('slotTotals', () => {
  it('按餐次分组', () => {
    const m1 = makeMeal({ items: [makeItem(rice)], slot: 'breakfast', date: '2026-10-22' });
    const m2 = makeMeal({ items: [makeItem(rice)], slot: 'lunch', date: '2026-10-22' });
    const t = slotTotals([m1, m2]);
    expect(t.breakfast).toBeCloseTo(174, 6);
    expect(t.lunch).toBeCloseTo(174, 6);
    expect(t.dinner).toBe(0);
  });
});
