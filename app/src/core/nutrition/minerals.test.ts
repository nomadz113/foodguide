import { describe, expect, it } from 'vitest';
import {
  barWidth, chunkMinerals, fmtMineral, fmtPct, itemMinerals, mealMinerals, MINERAL_KEYS,
} from './minerals';
import { facts } from './types';
import type { MealItem } from '../db/types';

function item(over: Partial<MealItem> = {}): MealItem {
  return {
    id: 'i1',
    name: '猪瘦肉丝',
    rawName: null,
    parentDish: null,
    foodId: 'food_1',
    matchType: 'library',
    matchScore: 0.9,
    grams: 100,
    baseG: 100,
    portionTier: 'medium',
    tierConfirmed: false,
    quantity: null,
    unit: null,
    gramSource: 'ai',
    per100g: facts({ kcal: 143 }),
    nutrition: facts({
      kcal: 143,
      calcium: 6, iron: 1.3, zinc: 2.9, selenium: 9.5, potassium: 305, magnesium: 25,
    }),
    fieldSource: {
      calcium: 'library', iron: 'library', zinc: 'library',
      selenium: 'library', potassium: 'library', magnesium: 'library',
    },
    components: null,
    confidence: 0.9,
    locked: false,
    ...over,
  };
}

/** 一项都匹配不上库的食物：矿物质全 null */
const unknown = item({
  id: 'i2', name: '孜然粉', foodId: null, matchType: 'ai',
  grams: 15, baseG: 15,
  nutrition: facts({ kcal: 17 }),
  fieldSource: {},
});

const TARGETS = {
  calcium: 800, iron: 12, zinc: 12.5, selenium: 60, potassium: 2000, magnesium: 330,
};

describe('fmtMineral', () => {
  it('≥10 取整、<10 保一位小数，整数不拖 .0', () => {
    expect(fmtMineral(305)).toBe('305');
    expect(fmtMineral(9.54)).toBe('9.5');
    expect(fmtMineral(6)).toBe('6');
    expect(fmtMineral(1.3)).toBe('1.3');
  });

  it('极小的非零值不能显示成 0 —— 那等于宣称测到了零', () => {
    expect(fmtMineral(0.04)).toBe('<0.1');
    expect(fmtMineral(0)).toBe('0');
  });
});

describe('itemMinerals', () => {
  it('六项都有值时列出六个 chip', () => {
    const r = itemMinerals(item());
    expect(r.chips.map((c) => c.key)).toEqual([...MINERAL_KEYS]);
    expect(r.missing).toBe(0);
    expect(r.emptyReason).toBeNull();
    expect(r.chips[0]).toMatchObject({ label: '钙', unit: 'mg', value: 6 });
  });

  it('老记录 fieldSource 是空的也不影响出数', () => {
    // fieldSource 是后加的字段，早期的餐没有它。chip 只读 nutrition，
    // 所以不该因为来源标记缺失就整行消失
    const r = itemMinerals(item({ fieldSource: undefined as unknown as MealItem['fieldSource'] }));
    expect(r.chips).toHaveLength(6);
    expect(r.emptyReason).toBeNull();
  });

  it('全空且没匹配上库 → 说明是「库里没有这条食物」', () => {
    const r = itemMinerals(unknown);
    expect(r.chips).toHaveLength(0);
    expect(r.missing).toBe(6);
    expect(r.emptyReason).toContain('食物库里没有「孜然粉」');
  });

  it('全空但匹配到了库 → 是另一种空，不能混为一谈', () => {
    const r = itemMinerals(item({
      name: '自制酱', nutrition: facts({ kcal: 90 }), fieldSource: {},
    }));
    expect(r.emptyReason).toContain('这条没有矿物质数据');
    expect(r.emptyReason).not.toContain('食物库里没有');
  });

  it('部分有值时如实数出缺几项', () => {
    const r = itemMinerals(item({
      nutrition: facts({ calcium: 6, iron: 1.3 }),
      fieldSource: { calcium: 'library', iron: 'library' },
    }));
    expect(r.chips).toHaveLength(2);
    expect(r.missing).toBe(4);
    expect(r.emptyReason).toBeNull();
  });

  it('null 绝不退化成 0 —— 缺的项不该出现「钙 0mg」', () => {
    const r = itemMinerals(item({ nutrition: facts({ calcium: null }) }));
    expect(r.chips.some((c) => c.key === 'calcium')).toBe(false);
  });
});

describe('mealMinerals', () => {
  it('逐项求和', () => {
    const s = mealMinerals([item(), unknown], TARGETS);
    const calcium = s.cells.find((c) => c.key === 'calcium')!;
    expect(calcium.value).toBe(6);
    expect(s.itemCount).toBe(2);
    expect(s.itemsWithData).toBe(1);
  });

  it('目标存在时算占比（6mg / 800mg = 0.75%）', () => {
    const s = mealMinerals([item()], TARGETS);
    expect(s.cells.find((c) => c.key === 'calcium')!.pct).toBeCloseTo(0.75, 6);
    expect(s.cells.find((c) => c.key === 'iron')!.pct).toBeCloseTo((1.3 / 12) * 100, 6);
  });

  it('没给目标时 pct 为 null，不是 0', () => {
    const s = mealMinerals([item()], {});
    expect(s.cells.every((c) => c.pct === null)).toBe(true);
    expect(s.cells.find((c) => c.key === 'calcium')!.value).toBe(6);
  });

  it('一项数据都没有时 value 是 null 而不是 0', () => {
    const s = mealMinerals([unknown], TARGETS);
    expect(s.cells.every((c) => c.value === null)).toBe(true);
    expect(s.itemsWithData).toBe(0);
  });

  it('空餐不报错', () => {
    const s = mealMinerals([], TARGETS);
    expect(s.itemCount).toBe(0);
    expect(s.cells).toHaveLength(6);
    expect(s.cells.every((c) => c.value === null)).toBe(true);
  });

  it('有食材没匹配上库 → 标为下限', () => {
    const s = mealMinerals([item(), unknown], TARGETS);
    expect(s.partial).toBe(true);
    // 100g 有值 + 15g 没值 → 钙只覆盖了 100/115 的克重
    expect(s.cells.find((c) => c.key === 'calcium')!.coverage).toBeCloseTo(100 / 115, 6);
  });

  it('全部食材都有数据 → 不是下限', () => {
    const s = mealMinerals([item()], TARGETS);
    expect(s.partial).toBe(false);
    expect(s.cells.find((c) => c.key === 'calcium')!.coverage).toBe(1);
  });
});

describe('占比文案与进度条', () => {
  it('不足 1% 如实写，不四舍五入成 1%', () => {
    expect(fmtPct(0.75)).toBe('占全天 <1%');
    expect(fmtPct(23.4)).toBe('占全天 23%');
    expect(fmtPct(null)).toBe('占全天 —');
  });

  it('超过 100% 的条要截断，但数字照实显示', () => {
    expect(barWidth(120)).toBe(100);
    expect(barWidth(23.4)).toBeCloseTo(23.4, 6);
    expect(barWidth(null)).toBe(0);
    expect(barWidth(-5)).toBe(0);
  });
});

describe('chunkMinerals', () => {
  it('6 项切成 5+1（用户定的排版，第一行满、第二行补齐）', () => {
    const rows = chunkMinerals(['钙', '铁', '锌', '硒', '钾', '镁']);
    expect(rows.map((r) => r.length)).toEqual([5, 1]);
    expect(rows[1]).toEqual(['镁']);
  });

  it('不足一行时不补空位', () => {
    expect(chunkMinerals(['钙', '铁']).map((r) => r.length)).toEqual([2]);
    expect(chunkMinerals(['钙', '铁', '锌', '硒', '钾']).map((r) => r.length)).toEqual([5]);
  });

  it('空数组返回空数组，不造一个空行（空行会在卡片里留一段莫名其妙的空隙）', () => {
    expect(chunkMinerals([])).toEqual([]);
  });

  it('十项以上继续按 5 切，不会因为超过一行就丢项', () => {
    const rows = chunkMinerals([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rows.map((r) => r.length)).toEqual([5, 5, 1]);
    expect(rows.flat()).toHaveLength(11);
  });
});
