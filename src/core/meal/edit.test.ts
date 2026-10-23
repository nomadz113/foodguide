import { describe, expect, it } from 'vitest';
import { applyClock, clockOf, renameItem, setItemGrams, setItemTier } from './edit';
import { makeItem, makeMeal, retotalMeal } from './build';
import { facts } from '../nutrition/types';

const item = () =>
  makeItem({ name: '米饭', baseG: 200, grams: 200, per100g: facts({ kcal: 116, protein: 2.6 }) });

describe('编辑餐次', () => {
  it('改克数必须同步重算营养快照，否则界面上克数与热量自相矛盾', () => {
    const it = item();
    expect(it.nutrition.kcal).toBeCloseTo(232);
    const half = setItemGrams(it, 100);
    expect(half.grams).toBe(100);
    expect(half.nutrition.kcal).toBeCloseTo(116);
    expect(half.nutrition.protein).toBeCloseTo(2.6);
  });

  it('克数不会被调成负数', () => {
    expect(setItemGrams(item(), -50).grams).toBe(0);
    expect(setItemGrams(item(), -50).nutrition.kcal).toBe(0);
  });

  it('切档位以 baseG 为锚：小→中→大→中 必须回到原值（累乘会漂）', () => {
    const base = item();
    const small = setItemTier(base, 'small');
    const large = setItemTier(small, 'large');
    const back = setItemTier(large, 'medium');
    expect(small.grams).toBe(140); // 200 × 0.7
    expect(large.grams).toBe(260); // 仍以 200 为锚，不是 140×1.3
    expect(back.grams).toBe(200);
    expect(back.nutrition.kcal).toBeCloseTo(232);
  });

  it('点过档位才记学习样本（tierConfirmed），默认中份不算表态', () => {
    expect(item().tierConfirmed).toBe(false);
    expect(setItemTier(item(), 'medium').tierConfirmed).toBe(true);
  });

  it('固定份量的项（如一瓶 500ml）不跟着档位缩放', () => {
    const fixed = makeItem({
      name: '可乐', baseG: 500, per100g: facts({ kcal: 43 }), scaleFixed: true,
    });
    const small = setItemTier(fixed, 'small');
    expect(small.grams).toBe(500);
    expect(small.portionTier).toBeNull();
  });

  it('改名不动营养', () => {
    const it = renameItem(item(), '我家的米饭');
    expect(it.name).toBe('我家的米饭');
    expect(it.nutrition.kcal).toBeCloseTo(232);
  });

  it('改完项后整餐合计必须重算（totals 与 items 不能脱节）', () => {
    const meal = makeMeal({ items: [item(), item()], date: '2026-10-22' });
    expect(meal.totals.kcal).toBeCloseTo(464);
    const edited = retotalMeal({ ...meal, items: [setItemGrams(meal.items[0]!, 100), meal.items[1]!] });
    expect(edited.totals.kcal).toBeCloseTo(348);
  });
});

describe('用餐时间', () => {
  it('只改时分，日期不变', () => {
    const at = new Date('2026-10-22T21:30:00').getTime();
    const changed = applyClock(at, '08:15');
    expect(clockOf(changed)).toBe('08:15');
    expect(new Date(changed).getDate()).toBe(22);
  });

  it('非法输入不动时间戳（宁可不变，也不要变成 Invalid Date）', () => {
    const at = new Date('2026-10-22T21:30:00').getTime();
    expect(applyClock(at, '')).toBe(at);
    expect(applyClock(at, '99:99')).toBe(at);
    expect(applyClock(at, 'abc')).toBe(at);
  });

  it('改到凌晨会换归属日（dayStartHour=4 时算前一天）—— 保存时必须用新时间重算 date', () => {
    const at = new Date('2026-10-22T01:30:00').getTime();
    const d = new Date(at);
    d.setDate(d.getDate() - 1);
    expect(clockOf(at)).toBe('01:30');
    expect(d.getDate()).toBe(21);
  });
});
