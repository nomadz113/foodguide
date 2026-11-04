import { describe, expect, it } from 'vitest';
import { facts } from '../nutrition/types';
import { makeItem, makeMeal } from '../meal/build';
import type { Meal, MealItem } from '../db/types';
import { computeTopSources } from './top';

/** values 是 per100g；克数另算 */
function item(name: string, grams: number, values: Record<string, number | null>, parentDish?: string): MealItem {
  return makeItem({
    name,
    per100g: facts(values),
    baseG: grams,
    grams,
    parentDish: parentDish ?? null,
  });
}

function mealOf(items: MealItem[]): Meal {
  return makeMeal({ items, date: '2026-10-27', slot: 'lunch' });
}

describe('今日来源 TOP3', () => {
  it('同一种食物当天出现多次要合并成一项，否则三碗米饭占满前三', () => {
    const meals = [
      mealOf([item('米饭', 200, { kcal: 116, fat: 0.5 })]),
      mealOf([item('米饭', 100, { kcal: 116, fat: 0.5 })]),
      mealOf([item('鸡胸肉', 100, { kcal: 133, fat: 3 })]),
      mealOf([item('西兰花', 100, { kcal: 34, fat: 0.4 })]),
    ];
    const top = computeTopSources(meals);
    expect(top.kcal.entries).toHaveLength(3);
    expect(top.kcal.entries![0]!.name).toBe('米饭');
    expect(top.kcal.entries![0]!.value).toBe(348); // 232 + 116
  });

  it('百分比分母是当日总量，不是榜单内部占比', () => {
    const meals = [
      mealOf([item('米饭', 200, { kcal: 116, fat: 0.5 })]),
      mealOf([item('米饭', 100, { kcal: 116, fat: 0.5 })]),
      mealOf([item('鸡胸肉', 100, { kcal: 133, fat: 3 })]),
      mealOf([item('西兰花', 100, { kcal: 34, fat: 0.4 })]),
    ];
    const top = computeTopSources(meals);
    expect(top.kcal.total).toBe(515); // 232 + 116 + 133 + 34
    expect(top.kcal.entries![0]!.pct).toBe(68); // 348 / 515
    expect(top.kcal.entries![1]!.pct).toBe(26); // 133 / 515
  });

  it('复合菜拆解后按食材计，烹调油能单独上脂肪榜', () => {
    const meals = [
      mealOf([
        item('番茄', 100, { kcal: 20, fat: 0.2 }, '番茄炒蛋'),
        item('鸡蛋', 50, { kcal: 144, fat: 10 }, '番茄炒蛋'),
        item('大豆油', 10, { kcal: 900, fat: 100 }, '番茄炒蛋'),
        item('米饭', 200, { kcal: 116, fat: 0.5 }),
        item('鸡胸肉', 100, { kcal: 133, fat: 3 }),
      ]),
    ];
    const top = computeTopSources(meals);
    const fatNames = top.fat.entries!.map((e) => e.name);
    expect(fatNames[0]).toBe('大豆油');
    expect(fatNames).toContain('鸡蛋');
    expect(fatNames).not.toContain('番茄炒蛋'); // 按食材计，不按整道菜
  });

  it('数据覆盖率不足就不排队，不拿半份数据当全天说', () => {
    const meals = [
      mealOf([item('米饭', 100, { kcal: 116, fat: 0.5 })]),
      mealOf([item('鸡胸肉', 300, { fiber: 0 })]), // 这一条没有热量与脂肪
    ];
    const top = computeTopSources(meals);
    expect(top.kcal.entries).toBeNull();
    expect(top.kcal.reason).toBe('coverage');
    expect(top.visible).toBe(false);
  });

  it('只吃了两样东西时「TOP3」是伪信息，整块不出', () => {
    const meals = [
      mealOf([
        item('米饭', 200, { kcal: 116, fat: 0.5 }),
        item('鸡胸肉', 100, { kcal: 133, fat: 3 }),
      ]),
    ];
    const top = computeTopSources(meals);
    expect(top.kcal.entries).toBeNull();
    expect(top.kcal.reason).toBe('few');
    expect(top.visible).toBe(false);
  });

  it('未知值不当成 0 混进榜单', () => {
    const meals = [
      mealOf([item('米饭', 100, { kcal: 116, fat: 0.5 })]),
      mealOf([item('鸡胸肉', 100, { kcal: 133, fat: 3 })]),
      mealOf([item('西兰花', 100, { kcal: 34 })]), // 脂肪未知
    ];
    const top = computeTopSources(meals);
    // 西兰花若被当成 0g 脂肪，就会凑成第三名 —— 那正是 null≠0 要防的
    expect(top.fat.entries).toBeNull();
    expect(top.fat.reason).toBe('few');
  });

  it('没有任何记录时整块不渲染', () => {
    const top = computeTopSources([]);
    expect(top.visible).toBe(false);
    expect(top.kcal.entries).toBeNull();
    expect(top.fat.entries).toBeNull();
  });
});
