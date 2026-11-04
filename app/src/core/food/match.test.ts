import { describe, it, expect } from 'vitest';
import { similarity, findMatch, findSuffixMatch, fillMicro, matchAndFill, FILL_KEYS } from './match';
import { SEED_FOODS } from './seed';
import { normalizeName } from './normalize';
import { facts } from '../nutrition/types';

/** 种子库里按名字取一条，方便断言 */
const seed = (name: string) => {
  const f = SEED_FOODS.find((x) => x.name === name);
  if (!f) throw new Error(`种子库缺少 ${name}`);
  return f;
};

describe('similarity —— bigram Dice', () => {
  it('同名字得 1', () => {
    expect(similarity('米饭', '米饭')).toBe(1);
    expect(similarity(' 米 饭 ', '米饭')).toBe(1);
  });

  it('只差一个字的不同食物必须判为 0，不能被编辑距离糊过去', () => {
    // 这是选 bigram 而不是 Levenshtein 的原因：编辑距离会给 0.5 以上
    expect(similarity('米饭', '米粉')).toBe(0);
    expect(similarity('腊肠', '腊肉')).toBe(0);
    expect(similarity('牛肉', '牛腩')).toBe(0);
  });

  it('长一点的词共享 bigram 才有分数', () => {
    expect(similarity('卤牛肉', '牛肉')).toBeGreaterThan(0.6);
    expect(similarity('鸡胸肉', '鸡胸')).toBeGreaterThan(0.6);
  });

  it('单字名退化成包含判断', () => {
    expect(similarity('虾仁', '虾')).toBeGreaterThanOrEqual(0.8);
    expect(similarity('虾', '米饭')).toBe(0);
  });
});

describe('findMatch —— 6 张实拍照片里出现过的食材', () => {
  const cases: [string, string][] = [
    ['米粉', '米粉'],
    ['河粉', '米粉'],
    ['米线', '米粉'],
    ['猕猴桃', '猕猴桃'],
    ['奇异果', '猕猴桃'],
    ['香肠', '腊肠'],
    ['广式腊肠', '腊肠'],
    ['白灼虾', '虾'],
    ['对虾', '虾'],
    ['卤牛肉', '卤牛肉'],
    ['酱牛肉', '卤牛肉'],
    ['牛腩', '牛腩'],
    ['杏鲍菇', '杏鲍菇'],
    ['面条', '面条'],
    ['挂面', '面条'],
    ['大米粥', '白粥'],
    ['稀饭', '白粥'],
    ['鸡蛋', '鸡蛋'],
    ['生菜', '生菜'],
    ['黄瓜', '黄瓜'],
    ['面窝', '面窝'],
    ['油饼', '面窝'],
  ];
  for (const [query, expected] of cases) {
    it(`「${query}」→ ${expected}`, () => {
      expect(findMatch(query, SEED_FOODS)?.food.name).toBe(expected);
    });
  }

  it('库里没有的（炸鸡块、蛋饺以外的复合物）宁可不匹配', () => {
    expect(findMatch('酥皮炸鸡块', SEED_FOODS)).toBeNull();
    expect(findMatch('红烧牛肉面', SEED_FOODS)).toBeNull();
    // 原来是「酸豆角」，库里有豆角之后它会以 0.67 命中（同类食材、不同腌制形态，
    // 属于可以接受的弱匹配）。这里换成库里确实没有的复合主食，继续守住「不硬配」这条线。
    expect(findMatch('螺蛳粉', SEED_FOODS)).toBeNull();
  });

  it('分数低于阈值一律不返回', () => {
    // 「虾」对「对虾」只是包含关系（0.8），卡到 0.99 就该拒绝
    expect(findMatch('虾', [{ name: '对虾', aliases: [] }], 0.99)).toBeNull();
  });

  it('同分时优先用户自建条目', () => {
    const list = [
      { name: '糙米饭', aliases: [], priority: 50 },
      { name: '糙米饭', aliases: [], priority: 100 },
    ];
    expect(findMatch('糙米饭', list)?.food.priority).toBe(100);
  });

  it('分数差距大于 0.05 时不让优先级翻盘', () => {
    const list = [
      { name: '糙米饭', aliases: [], priority: 50 },
      { name: '米', aliases: [], priority: 100 },
    ];
    // 「米」对「糙米饭」只是包含关系 0.8，而精确同名是 1，应取精确的
    expect(findMatch('糙米饭', list)?.food.name).toBe('糙米饭');
  });
});

describe('findSuffixMatch —— 做法前缀兜底', () => {
  it('无油煎鸡胸肉：Dice 只有 0.571 够不到阈值，尾锚定能接住', () => {
    expect(findMatch('无油煎鸡胸肉', SEED_FOODS)).toBeNull();
    expect(findSuffixMatch('无油煎鸡胸肉', SEED_FOODS)?.food.name).toBe('鸡胸肉');
  });

  it('空气炸 / 低脂水煮 这类 3~4 字前缀都能剥', () => {
    expect(findSuffixMatch('空气炸鸡腿', SEED_FOODS)?.food.name).toBe('鸡腿肉');
    expect(findSuffixMatch('低脂水煮牛肉', SEED_FOODS)?.food.name).toBe('牛肉');
  });

  it('最长命中优先：「鸡胸肉」必须压过短别名「鸡胸」', () => {
    const r = findSuffixMatch('香煎鸡胸肉', SEED_FOODS);
    expect(r?.matchedOn).toBe('鸡胸肉');
  });

  it('同长说明是精确命中，归 findMatch 管，这里不接管', () => {
    expect(findSuffixMatch('鸡胸肉', SEED_FOODS)).toBeNull();
    expect(findSuffixMatch('鸡胸', SEED_FOODS)).toBeNull();
  });

  it('主体不是那个食材时不许配', () => {
    // 中文构词是「定语+中心语」，做法只在前面：不以库名结尾就不是它
    expect(findSuffixMatch('鸡蛋灌饼', SEED_FOODS)).toBeNull();
    expect(findSuffixMatch('红烧牛肉面', SEED_FOODS)).toBeNull();
    // 前缀超过 4 字就不像「做法」了，更像另一样东西
    expect(findSuffixMatch('外婆做的老坛酸菜牛肉', SEED_FOODS)).toBeNull();
  });

  it('库里没有「鸡排」，尾锚定救不了 —— 这条只能靠提示词把它说成鸡胸肉', () => {
    expect(findSuffixMatch('无油煎鸡排', SEED_FOODS)).toBeNull();
  });
});

describe('fillMicro —— 只填空，不覆盖', () => {
  const ai = facts({ kcal: 110, protein: 2.6, fat: 0.3, carbs: 24.9, fiber: 0.4, sodium: 6 });

  it('补上 AI 没给的微量', () => {
    const r = fillMicro(ai, seed('米粉'));
    expect(r.per100g.calcium).toBe(10);
    expect(r.filled).toContain('calcium');
    expect(r.source).toBe('米粉');
  });

  it('AI 给的宏量原样保留，不被库覆盖', () => {
    const r = fillMicro(ai, seed('卤牛肉')); // 库里卤牛肉 246 kcal，AI 说 110
    expect(r.per100g.kcal).toBe(110);
    expect(r.per100g.protein).toBe(2.6);
    expect(r.per100g.sodium).toBe(6);
    expect(r.filled).not.toContain('kcal');
  });

  it('FILL_KEYS 不含宏量与钠（钠另有「纯钠调味料」例外，见下一组）', () => {
    for (const k of ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sodium'] as const) {
      expect(FILL_KEYS).not.toContain(k);
    }
  });

  it('库里该项也是 null 时保持 null，绝不填 0', () => {
    // 用一个刻意留空的条目，不依赖种子库某条恰好缺哪项 ——
    // 种子库补全后，「米粉没有维生素 C」已经变成真实的 0，不能再拿它当 null 的例子
    const sparse = { name: '只有宏量的食物', per100g: facts({ kcal: 100, protein: 5, vc: null, vd: null }) };
    const r = fillMicro(ai, sparse);
    expect(r.per100g.vc).toBeNull();
    expect(r.per100g.vd).toBeNull();
    expect(r.filled).toEqual([]);
  });

  it('没匹配上时原样返回', () => {
    const r = fillMicro(ai, null);
    expect(r.per100g).toEqual(ai);
    expect(r.filled).toEqual([]);
    expect(r.source).toBeNull();
  });
});

describe('matchAndFill —— 端到端', () => {
  it('猕猴桃：AI 给宏量，库补 VC/钾/叶酸外的那几项', () => {
    const ai = facts({ kcal: 61, protein: 0.8, fat: 0.6, carbs: 14.5 });
    const { per100g, match, filled } = matchAndFill('猕猴桃', ai, SEED_FOODS);
    expect(match?.food.name).toBe('猕猴桃');
    expect(per100g.vc).toBe(62);
    expect(per100g.kcal).toBe(61);
    expect(filled.length).toBeGreaterThan(5);
  });

  it('匹配不上的条目微量保持 null，交给 UI 显示「—」', () => {
    const ai = facts({ kcal: 200, protein: 10, fat: 12, carbs: 8 });
    const { per100g, match, filled } = matchAndFill('外婆做的神秘酱', ai, SEED_FOODS);
    expect(match).toBeNull();
    expect(filled).toEqual([]);
    expect(per100g.calcium).toBeNull();
  });
});

describe('种子库自身完整性', () => {
  it('nameKey 不重复（重复会让匹配永远只取到第一条）', () => {
    const seen = new Map<string, string>();
    for (const f of SEED_FOODS) {
      const k = normalizeName(f.name);
      const prev = seen.get(k);
      expect(prev, `「${f.name}」与「${prev}」归一化后同名`).toBeUndefined();
      seen.set(k, f.name);
    }
  });

  it('id 唯一', () => {
    expect(new Set(SEED_FOODS.map((f) => f.id)).size).toBe(SEED_FOODS.length);
  });

  it('营养素数值要么是有限数要么是 null，不允许 NaN', () => {
    for (const f of SEED_FOODS) {
      for (const [k, v] of Object.entries(f.per100g)) {
        if (v !== null) expect(Number.isFinite(v), `${f.name}.${k}`).toBe(true);
      }
    }
  });

  it('热量与三大宏量不自相矛盾', () => {
    // 能量不来自三大宏量的食物，4/4/9 天然推不出来：
    // 啤酒靠酒精（7kcal/g），醋靠醋酸（约 4~5% 醋酸 ×3.5kcal/g），两者的碳水都接近 0。
    const ENERGY_NOT_FROM_MACROS = new Set(['啤酒', '醋']);
    // 高纤维干货：成分表的碳水列是「总碳水（含膳食纤维）」，而纤维实际按 2kcal/g 供能。
    // 干香菇 274kcal / 总碳水 61.7（纤维 31.6）用 4/4/9 反推会高估到 338，
    // 这是膳食纤维能量系数不同造成的，不是数据错误。
    const HIGH_FIBER_DRY = new Set(['干香菇', '木耳', '紫菜']);
    for (const f of SEED_FOODS) {
      if (ENERGY_NOT_FROM_MACROS.has(f.name) || HIGH_FIBER_DRY.has(f.name)) continue;
      const { kcal, protein, fat, carbs, fiber } = f.per100g;
      // 零卡饮料（无糖可乐 0.2 kcal）基数太小，比例失真没有意义
      if (kcal == null || kcal <= 1) continue;
      // 膳食纤维按 2kcal/g 计（中国食物成分表的能量折算口径），不是 4。
      // 原先碳水整体按 4 算，芦笋这类「碳水 3.9 里纤维占 2.1」的蔬菜会被推高 27% 而误报，
      // 但它们表上的能量是对的 —— 是折算系数错了，不是数据错了。
      const fib = fiber ?? 0;
      const availCarb = Math.max(0, (carbs ?? 0) - fib);
      const derived = (protein ?? 0) * 4 + availCarb * 4 + fib * 2 + (fat ?? 0) * 9;
      const drift = Math.abs(kcal - derived) / kcal;
      // 叶菜类热量基数只有十几大卡，任何小误差比例都会被放大；
      // 低热量水果（柠檬 29kcal / 碳水 9.3 里纤维 2.8）用 4/4/9 反推也天然偏高 ——
      // USDA 对水果用的是食物专属折算系数（碳水 3.36kcal/g），不是通用 4。
      // 所以再给一条绝对容差：差 12kcal 以内不追究（占一天 2000kcal 的 0.6%），
      // 但真填错（米饭写成 60、鸡胸写成 300）绝对值和比例都会同时超限，照样会被抓住。
      const tol = kcal < 40 ? 0.25 : 0.15;
      const ok = drift < tol || Math.abs(kcal - derived) <= 12;
      expect(ok, `${f.name}: 标注 ${kcal} kcal，宏量推算 ${derived.toFixed(0)}`).toBe(true);
    }
  });
});
