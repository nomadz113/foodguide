import { describe, expect, it } from 'vitest';
import { suggestActions } from './actions';

const base = {
  proteinGap: 0, fiberGap: 0, remain: 500, kcalTarget: 1902,
  saltG: null, saltLimitG: 5.1, mealCount: 2,
};

describe('可执行建议的克数由代码算', () => {
  it('蛋白缺 101g 时分开两餐给，并算出每餐克数', () => {
    const [a] = suggestActions({ ...base, proteinGap: 101 });
    expect(a).toContain('分两餐');
    expect(a).toContain('260g 鸡胸肉'); // 101/2/19.4*100 ≈ 260
    expect(a).toContain('50g 蛋白');    // 260g × 19.4% ≈ 50
  });

  it('小缺口给克数+鸡蛋两个选项，不出现「吃一口」这种没法执行的建议', () => {
    const [a] = suggestActions({ ...base, proteinGap: 25 });
    expect(a).toContain('130g 鸡胸肉');
    expect(a).toContain('4 个鸡蛋');
  });

  it('蛋白已达标时完全不提蛋白', () => {
    const list = suggestActions({ ...base, proteinGap: -5, remain: 300 });
    expect(list.join('')).not.toContain('蛋白');
  });

  it('纤维缺口翻成绿叶菜克数', () => {
    const list = suggestActions({ ...base, fiberGap: 12 });
    // 12g 纤维理论上要 545g 菜，封顶到 500g（一斤）
    expect(list.join('')).toContain('500g 绿叶菜');
  });

  it('纤维缺口极大时不会给出「1.3kg 绿叶菜」这种做不到的建议', () => {
    const text = suggestActions({ ...base, fiberGap: 30 }).join('');
    expect(text).toContain('500g 绿叶菜');
    expect(text).toContain('分几次');
    expect(text).not.toMatch(/\d{4}g 绿叶菜/);
  });

  it('盐接近上限时给替换动作，而不是「少放盐」', () => {
    const list = suggestActions({ ...base, saltG: 4.5 });
    expect(list.join('')).toContain('白灼或清蒸');
  });

  it('没记录时不给任何营养建议', () => {
    const list = suggestActions({ ...base, mealCount: 0 });
    expect(list).toHaveLength(1);
    expect(list[0]).toContain('第一餐');
  });

  it('最多 3 条，按缺口优先级排序', () => {
    const list = suggestActions({ ...base, proteinGap: 80, fiberGap: 15, remain: 900, saltG: 5 });
    expect(list).toHaveLength(3);
    expect(list[0]).toContain('蛋白');
  });
});
