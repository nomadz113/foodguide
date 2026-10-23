import { describe, expect, it } from 'vitest';
import {
  adviceAllowedNumbers, numbersIn, parseAdvice, type AdvicePayload,
} from './advice';

const payload: AdvicePayload = {
  goalType: 'lose',
  hour: 19,
  kcalTarget: 1902,
  kcalIntake: 450,
  remain: 1452,
  proteinTarget: 131,
  proteinIntake: 30,
  proteinGap: 101,
  fiberTarget: 25,
  fiberIntake: 3,
  fiberGap: 22,
  saltG: 2.1,
  saltLimitG: 5.1,
  meals: [{ slot: '晚餐', kcal: 450, items: ['米饭 250g', '鸡胸肉 120g'] }],
  dataNotes: ['膳食纤维数据不完整'],
  suggestedActions: ['蛋白还差 101g，一顿吃不下：分两餐各加 260g 鸡胸肉（约 50g 蛋白）'],
  weightKg: 78,
  targetWeightKg: 68,
  projectedDays: 120,
};

describe('模型输出的数字溯源', () => {
  it('引用算好的克数可以通过', () => {
    const doc = parseAdvice({
      headline: '蛋白缺口大',
      body: '还差 101g 蛋白，分两餐补。',
      actions: ['分两餐各加 260g 鸡胸肉'],
    }, adviceAllowedNumbers(payload));
    expect(doc.actions).toHaveLength(1);
  });

  it('自己算出来的营养素数字被丢掉 —— 实测模型会写「150g 鸡胸肉补 45g 蛋白」', () => {
    const doc = parseAdvice({
      headline: '蛋白缺口大',
      body: '还差 101g 蛋白。',
      actions: [
        '加 150g 鸡胸肉，补约 45g 蛋白', // 45 不在允许集合里 → 丢
        '加 260g 鸡胸肉',                // 260 来自 suggestedActions → 留
      ],
    }, adviceAllowedNumbers(payload));
    expect(doc.actions).toEqual(['加 260g 鸡胸肉']);
  });

  it('份数这类小整数放行：「2 个鸡蛋」「3 餐」是正常表达', () => {
    const doc = parseAdvice({
      headline: 'x', body: 'y',
      actions: ['加 2 个鸡蛋', '剩下 3 餐按 1 份蛋白配'],
    }, adviceAllowedNumbers(payload));
    expect(doc.actions).toHaveLength(2);
  });

  it('已记录食物的克数允许被引用', () => {
    const doc = parseAdvice({
      headline: 'x', body: 'y',
      actions: ['晚饭那 250g 米饭可以减到 150g'],
    }, adviceAllowedNumbers(payload));
    // 250 来自记录；150 不在集合里 → 整条被丢
    expect(doc.actions).toHaveLength(0);
  });

  it('缺 headline 或 body 直接失败，让调用方退回本地建议', () => {
    expect(() => parseAdvice({ headline: '只有标题' })).toThrow();
    expect(() => parseAdvice({ body: '只有正文' })).toThrow();
  });

  it('数字抽取能处理千分位与小数', () => {
    expect(numbersIn('1,902 kcal 与 2.1g 盐')).toEqual([1902, 2.1]);
  });
});
