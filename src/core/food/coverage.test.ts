/**
 * 种子库微量覆盖率 —— 回归测试。
 *
 * 为什么这条测试值得单独存在：
 * 视觉模型只稳定输出 6 项（热量/蛋白/脂肪/碳水/纤维/钠），13 项维生素矿物质
 * **完全依赖这张表**在 matchAndFill 里补。而 coverage 是按克重加权的，
 * 每餐只要有一项在库里是 null，该项的覆盖率就被拉低；低于 50% 时
 * 今日页就显示「—」并且不计入达标分母 —— 功能等于失效。
 *
 * 曾经的实测值（2026-10-22 补数据前）：
 *   VD 5% · VE 8% · VA 19% · 烟酸 19% · B2 21% · B1 29% · 锌 44% · 镁 46%
 * 也就是说一半以上的微量项长期处于「看不出来」的状态。
 */

import { describe, it, expect } from 'vitest';
import { SEED_FOODS } from './seed';
import { MICRO_KEYS, NUTRIENT_LABELS, isKnown } from '../nutrition/types';

function coverage(k: (typeof MICRO_KEYS)[number]): number {
  const n = SEED_FOODS.filter((f) => isKnown(f.per100g[k])).length;
  return n / SEED_FOODS.length;
}

describe('种子库微量覆盖率', () => {
  it('13 项单项覆盖率都不低于 90%', () => {
    const low = MICRO_KEYS
      .map((k) => ({ label: NUTRIENT_LABELS[k], c: coverage(k) }))
      .filter((x) => x.c < 0.9)
      .map((x) => `${x.label} ${Math.round(x.c * 100)}%`);
    expect(low, `这些微量项的库内覆盖率不足 90%：${low.join('、')}`).toEqual([]);
  });

  it('每条食物的已知微量项不少于 10 项', () => {
    const thin = SEED_FOODS
      .map((f) => ({ name: f.name, n: MICRO_KEYS.filter((k) => isKnown(f.per100g[k])).length }))
      .filter((x) => x.n < 10);
    expect(thin.map((x) => `${x.name}(${x.n})`)).toEqual([]);
  });

  it('维生素 D 的决定性来源在库里存在', () => {
    // VD 是补剂之外最难吃够的一项（RNI 10μg），没有海鱼和菌菇就是必然缺口。
    // 这里守的不是"填了值"，而是"这些食材没有被误删或改名"。
    const names = new Set(SEED_FOODS.map((f) => f.name));
    for (const n of ['三文鱼', '带鱼', '干香菇', '鸡蛋', '鲈鱼']) {
      expect(names.has(n), `缺少 VD 来源「${n}」`).toBe(true);
    }
    const salmon = SEED_FOODS.find((f) => f.name === '三文鱼');
    expect(salmon?.per100g.vd).toBeGreaterThanOrEqual(10);
  });

  it('干香菇与鲜香菇是两个条目且 VD 差一个量级', () => {
    // 干香菇曾挂在「香菇」的 aliases 里，模糊匹配会把干香菇认成鲜香菇，
    // VD 一项直接少算 20 倍。这条断言守住它们必须是独立条目。
    const fresh = SEED_FOODS.find((f) => f.name === '香菇');
    const dry = SEED_FOODS.find((f) => f.name === '干香菇');
    expect(fresh).toBeTruthy();
    expect(dry).toBeTruthy();
    expect(fresh!.aliases).not.toContain('干香菇');
    expect((dry!.per100g.vd as number) / (fresh!.per100g.vd as number)).toBeGreaterThan(10);
  });

  it('高杠杆食材的招牌营养素没有被写错量级', () => {
    const at = (name: string) => SEED_FOODS.find((f) => f.name === name)!.per100g;
    expect(at('猪肝').va).toBeGreaterThan(4000);      // 维生素 A 头号来源
    expect(at('牡蛎').zinc).toBeGreaterThan(8);        // 锌含量第一
    expect(at('黑芝麻').calcium).toBeGreaterThan(700); // 植物性钙第一梯队
    expect(at('葵花籽油').ve).toBeGreaterThan(50);     // 维生素 E 头号来源
    expect(at('紫菜').potassium).toBeGreaterThan(1500);
    expect(at('木耳').iron).toBeGreaterThan(50);
  });
});
