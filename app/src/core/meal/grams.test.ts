import { describe, expect, it } from 'vitest';
import { fmtGrams, gramsStep, roundGrams } from './grams';

describe('roundGrams —— 小克数留 1 位小数', () => {
  it('调味料那零点几克不再被抹平（这是改这个文件的全部理由）', () => {
    // 焯水配菜的盐 0.3~0.5g，取整成 1g 就是 +150%~233% 的钠
    expect(roundGrams(0.3)).toBe(0.3);
    expect(roundGrams(0.4)).toBe(0.4);
    expect(roundGrams(0.5)).toBe(0.5);
    expect(roundGrams(1.8)).toBe(1.8);
    expect(roundGrams(3.15)).toBe(3.2);
  });

  it('20g 以上取整 —— 206.9g 是假精确，也不可读', () => {
    expect(roundGrams(206.9)).toBe(207);
    expect(roundGrams(20)).toBe(20);
    expect(roundGrams(19.9)).toBe(19.9);
    expect(roundGrams(150)).toBe(150);
  });

  it('兜底是「下限」不是「夹逼」：0.3g 不会被抬到 0.5g', () => {
    expect(roundGrams(0.3, 0.5)).toBe(0.5); // 显式给了 0.5 才抬
    expect(roundGrams(0.3)).toBe(0.3); // 默认 0.1 不动它
  });

  it('0 和非法值落到最小刻度，绝不返回 0 或 NaN', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, 'x']) {
      expect(roundGrams(bad as never), String(bad)).toBe(0.1);
    }
  });

  it('浮点尾巴被抹掉（0.1+0.2 不是 0.3）', () => {
    expect(roundGrams(0.1 + 0.2)).toBe(0.3);
    expect(roundGrams(2.46)).toBe(2.5);
  });
});

describe('fmtGrams —— 显示层', () => {
  it('不带多余的零，也不带浮点尾巴', () => {
    expect(fmtGrams(0.4)).toBe('0.4');
    expect(fmtGrams(3)).toBe('3');
    expect(fmtGrams(150)).toBe('150');
    expect(fmtGrams(0.30000000000000004)).toBe('0.3');
  });

  it('非法值不显示 NaN', () => {
    expect(fmtGrams(Number.NaN)).toBe('0');
  });
});

describe('gramsStep —— 刻度跟着当前克数走', () => {
  it('盐那 0.4g 用 0.5g 一格（3g 一步等于没法调）', () => {
    expect(gramsStep(0.4)).toBe(0.5);
    expect(gramsStep(5)).toBe(0.5);
  });

  it('油、调味料仍是 3g 一格', () => {
    expect(gramsStep(8)).toBe(3);
    expect(gramsStep(60)).toBe(3);
  });

  it('主食和菜 10g 一格 —— 一碗饭 150g 按 3g 要按 50 下', () => {
    expect(gramsStep(150)).toBe(10);
    expect(gramsStep(61)).toBe(10);
  });

  it('0 或非法值按最小档走，不会出现 0 步长（按了没反应）', () => {
    expect(gramsStep(0)).toBe(0.5);
    expect(gramsStep(Number.NaN)).toBe(0.5);
  });
});
