import { describe, expect, it } from 'vitest';
import {
  BIAS_MAX, BIAS_MIN_SAMPLES, TIER_FACTOR, applyTier, applyTierToItems,
  learnBias, looksLikeSeasoning, tierFactor, tierGrams, withBias,
  type TierSample,
} from './tier';
import { facts } from '../nutrition/types';
import type { MealItem } from '../db/types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 22);

function item(over: Partial<MealItem> = {}): MealItem {
  return {
    id: 'i1',
    name: '米饭',
    rawName: null,
    parentDish: null,
    foodId: null,
    matchType: 'ai',
    matchScore: null,
    grams: 150,
    baseG: 150,
    portionTier: 'medium',
    tierConfirmed: false,
    quantity: null,
    unit: null,
    gramSource: 'ai',
    per100g: facts({ kcal: 116, protein: 2.6, carbs: 25.9, fiber: null }),
    nutrition: facts({ kcal: 174, protein: 3.9, carbs: 38.85, fiber: null }),
    fieldSource: {},
    components: null,
    confidence: 0.8,
    locked: false,
    ...over,
  };
}

describe('倍率', () => {
  it('对称 ±30%，中份是恒等', () => {
    expect(TIER_FACTOR).toEqual({ small: 0.7, medium: 1, large: 1.3 });
    expect(tierFactor('medium')).toBe(1);
  });

  it('油/调味料只走一半：小 0.85、大 1.15', () => {
    expect(tierFactor('small', 0.5)).toBeCloseTo(0.85, 10);
    expect(tierFactor('large', 0.5)).toBeCloseTo(1.15, 10);
  });

  it('阻尼越界会被夹到 0~1', () => {
    expect(tierFactor('large', 5)).toBeCloseTo(1.3, 10);
    expect(tierFactor('large', -1)).toBeCloseTo(1, 10);
  });

  it('按名字识别调味料', () => {
    expect(looksLikeSeasoning('大豆油')).toBe(true);
    expect(looksLikeSeasoning('白砂糖')).toBe(true);
    expect(looksLikeSeasoning('生抽酱油')).toBe(true);
    expect(looksLikeSeasoning('番茄炒蛋')).toBe(false);
  });
});

describe('applyTier', () => {
  it('中份不改任何值', () => {
    const r = applyTier(item(), 'medium');
    expect(r.item.grams).toBe(150);
    expect(r.item.nutrition.kcal).toBeCloseTo(174, 6);
    expect(r.factor).toBe(1);
  });

  it('大份克数与热量同步放大', () => {
    const r = applyTier(item(), 'large');
    expect(r.item.grams).toBe(195);
    expect(r.item.nutrition.kcal).toBeCloseTo(226.2, 6);
    expect(r.item.nutrition.protein).toBeCloseTo(5.07, 6);
    expect(r.item.portionTier).toBe('large');
    expect(r.item.gramSource).toBe('user');
  });

  it('从当前档位切档也以 baseG 为锚，不累积误差', () => {
    const once = applyTier(item(), 'large').item;
    const twice = applyTier(once, 'small').item;
    expect(twice.grams).toBe(105);
    expect(twice.grams).toBe(applyTier(item(), 'small').item.grams);
  });

  it('烹调油按阻尼缩放，不随菜量线性放大', () => {
    const oil = item({ name: '大豆油', grams: 12, baseG: 12, per100g: facts({ kcal: 899, fat: 99.9 }), nutrition: facts({ kcal: 107.88, fat: 11.99 }) });
    const large = applyTier(oil, 'large');
    expect(large.item.grams).toBe(14); // 12 × 1.15 = 13.8
    expect(large.factor).toBeCloseTo(1.15, 10);
  });

  it('locked 项不被整餐缩放', () => {
    const r = applyTier(item({ locked: true }), 'large');
    expect(r.skipped).toBe('locked');
    expect(r.item.grams).toBe(150);
  });

  it('固定份量（一瓶饮料）不做缩放', () => {
    const r = applyTier(item({ name: '无糖可乐', scaleFixed: true, grams: 500, baseG: 500 }), 'large');
    expect(r.skipped).toBe('fixed');
    expect(r.item.grams).toBe(500);
  });

  it('null 营养素保持 null，不会变成 0', () => {
    const r = applyTier(item(), 'large');
    expect(r.item.nutrition.fiber).toBeNull();
  });

  it('per100g 缺失但旧快照有的字段按比例沿用', () => {
    const it0 = item({
      per100g: facts({ kcal: 116 }),
      nutrition: facts({ kcal: 174, sodium: 3 }),
    });
    const r = applyTier(it0, 'large');
    expect(r.item.nutrition.sodium).toBeCloseTo(3.9, 6);
  });

  it('整餐切换只影响可缩放项', () => {
    const items = [
      item({ id: 'a' }),
      item({ id: 'b', name: '大豆油', grams: 12, baseG: 12 }),
      item({ id: 'c', name: '无糖可乐', scaleFixed: true, grams: 500, baseG: 500 }),
    ];
    const out = applyTierToItems(items, 'small');
    expect(out.map((x) => x.grams)).toEqual([105, 10, 500]);
  });

  it('基准份为 0 时不产生负数', () => {
    expect(tierGrams(0, 'small')).toBe(0);
    expect(tierGrams(-10, 'large')).toBe(0);
  });
});

describe('个人偏置学习', () => {
  const s = (factor: number, daysAgo = 0): TierSample => ({ factor, at: NOW - daysAgo * DAY });

  it('样本不足 3 次不学习', () => {
    const r = learnBias([s(1.3), s(1.3)], NOW);
    expect(r.applied).toBe(false);
    expect(r.bias).toBe(1);
  });

  it('一直选大份 → 偏置上调但不越界', () => {
    const r = learnBias([s(1.3), s(1.3), s(1.3), s(1.3)], NOW);
    expect(r.applied).toBe(true);
    expect(r.bias).toBeGreaterThan(1);
    expect(r.bias).toBeLessThan(1.3); // 收缩，不一次纠到位
    expect(r.bias).toBeLessThanOrEqual(BIAS_MAX);
  });

  it('全选中份 → 偏置为 1（AI 本来就准）', () => {
    const r = learnBias([s(1), s(1), s(1), s(1)], NOW);
    expect(r.bias).toBeCloseTo(1, 10);
    expect(r.applied).toBe(false);
  });

  it('大小份各半 → 抵消为 1', () => {
    const r = learnBias([s(1.3), s(0.7), s(1.3), s(0.7), s(1)], NOW);
    expect(r.bias).toBeCloseTo(1, 6);
  });

  it('旧样本权重衰减，近期选择主导', () => {
    const old = learnBias([s(0.7, 400), s(0.7, 400), s(0.7, 400), s(1.3)], NOW);
    const fresh = learnBias([s(0.7), s(0.7), s(0.7), s(1.3)], NOW);
    expect(old.bias).toBeGreaterThan(fresh.bias);
  });

  it('极端历史也不会把偏置推出裁剪区间', () => {
    const many = Array.from({ length: 50 }, () => s(1.3));
    expect(learnBias(many, NOW).bias).toBe(BIAS_MAX);
    const low = Array.from({ length: 50 }, () => s(0.7));
    expect(learnBias(low, NOW).bias).toBeCloseTo(0.8, 10);
  });

  it('有效样本量 < 3 时即使 50 条陈年记录也不生效', () => {
    const stale = Array.from({ length: 50 }, () => s(1.3, 365 * 5));
    expect(learnBias(stale, NOW).applied).toBe(false);
  });

  it('withBias 会给新识别的基准份乘上偏置', () => {
    expect(withBias(200, 1.12)).toBe(224);
    expect(withBias(200, 1)).toBe(200);
    expect(withBias(200, 0)).toBe(200); // 非法输入退化为原值
    expect(withBias(3, 0.8)).toBe(2);
  });

  it('多轮迭代能收敛到更大的系统性偏差', () => {
    // AI 低估 60%，用户永远点大份：1.3 → 1.3×1.3 …
    let base = 100;
    const history: TierSample[] = [];
    for (let round = 0; round < 6; round++) {
      const { bias } = learnBias(history, NOW);
      base = withBias(base, bias);
      history.push(s(1.3), s(1.3), s(1.3));
    }
    expect(base).toBeGreaterThan(150);
    expect(BIAS_MIN_SAMPLES).toBe(3);
  });
});
