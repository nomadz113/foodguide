import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { bootstrap, allFoods, customFoods, mealsOfDay } from '../db/repo';
import { parseIntent, toFacts, IntentSchema } from '../ai/intent';
import {
  inferShare, resolveIntent, withItemGrams, withShare, withServingGrams, withServingValue,
  type FoodCard, type MealCard,
} from './resolve';
import { applyCard } from './apply';
import { isKnown } from '../nutrition/types';
import type { Intent } from '../ai/intent';

const TODAY = '2026-10-22';

function baseIntent(patch: Partial<Intent>): Intent {
  return {
    type: 'unknown', confidence: 0.9, reply: '', food: null, meal: null, target: null,
    assumptions: [], missing: [], caveats: [],
    ...patch,
  };
}

/** "记住，我妈做的红烧肉，一碗大概 320 大卡，蛋白质 18g、脂肪 22g、碳水 15g" 的解析结果 */
function hongshaorou(): Intent {
  return baseIntent({
    type: 'create_food',
    reply: '记下了，妈妈牌红烧肉一碗 320 大卡。',
    food: {
      name: '妈妈牌红烧肉',
      aliases: ['红烧肉', '我妈做的红烧肉'],
      category: '家常菜',
      nutritionBasis: 'per_serving',
      serving: { quantity: 1, unit: '碗', grams: 250 },
      values: { kcal: 320, protein: 18, fat: 22, carbs: 15 },
    },
    assumptions: ['「一碗」按 250g 估算'],
    missing: ['纤维', '钠', '维生素矿物质'],
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await bootstrap();
});

describe('toFacts —— 脏数据清洗', () => {
  it('丢弃不认识的键', () => {
    const f = toFacts({ kcal: 100, 乱写的: 5, protein: 3 });
    expect(f.kcal).toBe(100);
    expect(f.protein).toBe(3);
    expect(Object.keys(f)).not.toContain('乱写的');
  });

  it('热量封顶 900，负数归零', () => {
    expect(toFacts({ kcal: 32000 }).kcal).toBe(900);
    expect(toFacts({ kcal: -5 }).kcal).toBe(0);
  });

  it('null 与缺失都保持 null，不变成 0', () => {
    const f = toFacts({ kcal: 100, protein: null });
    expect(f.protein).toBeNull();
    expect(f.fat).toBeNull();
  });
});

describe('parseIntent —— 解析失败一律降级', () => {
  it('合法输入通过 schema', () => {
    const i = parseIntent(IntentSchema.parse(hongshaorou()));
    expect(i.type).toBe('create_food');
    expect(i.food?.nutritionBasis).toBe('per_serving');
  });

  it('缺 type 直接变 unknown，绝不让坏数据进确认卡', () => {
    const i = parseIntent({ reply: '嗯' });
    expect(i.type).toBe('unknown');
    expect(i.confidence).toBe(0);
  });

  it('confidence 越界被钳制', () => {
    const i = parseIntent({ ...hongshaorou(), confidence: 5 });
    expect(i.confidence).toBeLessThanOrEqual(1);
  });
});

describe('resolveIntent —— create_food', () => {
  it('per_serving 换算成 per100g：320kcal/250g → 128kcal/100g', () => {
    const card = resolveIntent(hongshaorou(), { foods: [], today: TODAY }) as FoodCard;
    expect(card.kind).toBe('create_food');
    expect(card.per100g.kcal).toBeCloseTo(128, 5);
    expect(card.per100g.protein).toBeCloseTo(7.2, 5);
    expect(card.per100g.fat).toBeCloseTo(8.8, 5);
    expect(card.per100g.carbs).toBeCloseTo(6, 5);
    // 用户看到的还是"一碗 320"
    expect(card.servingKcal).toBe(320);
  });

  it('per_100g 不换算', () => {
    const i = hongshaorou();
    i.food!.nutritionBasis = 'per_100g';
    i.food!.serving = null;
    const card = resolveIntent(i, { foods: [], today: TODAY }) as FoodCard;
    expect(card.per100g.kcal).toBe(320);
    expect(card.servingKcal).toBeNull();
  });

  it('说了"一份"但没给克数 → 拦下来问，不猜', () => {
    const i = hongshaorou();
    i.food!.serving = { quantity: 1, unit: '碗', grams: 0 };
    const card = resolveIntent(i, { foods: [], today: TODAY });
    expect(card.kind).toBe('text');
    if (card.kind === 'text') expect(card.reply).toContain('多重');
  });

  it('没有热量 → 拦下来，因为记了也用不上', () => {
    const i = hongshaorou();
    i.food!.values = { protein: 18 };
    const card = resolveIntent(i, { foods: [], today: TODAY });
    expect(card.kind).toBe('text');
  });

  it('用户没提的微量保持 null 并列入 missing', () => {
    const card = resolveIntent(hongshaorou(), { foods: [], today: TODAY }) as FoodCard;
    expect(card.per100g.vc).toBeNull();
    expect(card.per100g.sodium).toBeNull();
    // 模型给了 missing 就用它的归纳（比堆 14 个名字好读）
    expect(card.missing).toContain('纤维');
  });

  it('模型没给 missing 时由实际空缺字段推出来', () => {
    const i = hongshaorou();
    i.missing = [];
    const card = resolveIntent(i, { foods: [], today: TODAY }) as FoodCard;
    expect(card.missing.length).toBeGreaterThanOrEqual(13);
    expect(card.missing).toContain('维生素C');
  });

  it('同名自定义条目存在时提醒会被覆盖', async () => {
    // 先建一条自定义，再用同名 update
    await applyCard(resolveIntent(hongshaorou(), { foods: await allFoods(), today: TODAY }) as FoodCard);
    const foods = await allFoods();
    const card = resolveIntent(
      { ...hongshaorou(), type: 'update_food' },
      { foods, today: TODAY },
    ) as FoodCard;
    expect(card.existingId).toBeTruthy();
    expect(card.existingSource).toBe('custom');
    expect(card.caveats.join('')).toContain('覆盖');
  });

  it('和内置条目同名时提示是并存而不是覆盖', async () => {
    const foods = await allFoods();
    const i = hongshaorou();
    i.food!.name = '米饭';
    const card = resolveIntent(i, { foods, today: TODAY }) as FoodCard;
    expect(card.existingSource).toBe('preset');
    expect(card.caveats.join('')).toContain('并存');
  });
});

describe('resolveIntent —— log_meal', () => {
  const mealIntent = (items: { name: string; grams: number; per100g?: Record<string, number> }[]) =>
    baseIntent({
      type: 'log_meal',
      reply: '记上午餐了。',
      meal: {
        slot: 'lunch',
        date: null,
        items: items.map((it) => ({
          name: it.name,
          grams: it.grams,
          dish: null,
          per100g: it.per100g ?? null,
        })),
      },
    });

  it('命中库条目也只借微量，宏量仍用 AI 的这盘菜（与拍照/AddMeal 同口径）', async () => {
    const foods = await allFoods();
    // 内置「米饭」116 kcal/100g；AI 说这碗 130 —— 宏量保留 AI 的，糖与 13 项微矿由库补齐
    const card = resolveIntent(
      mealIntent([{ name: '米饭', grams: 150, per100g: { kcal: 130, protein: 3, fat: 0.4, carbs: 28 } }]),
      { foods, today: TODAY },
    ) as MealCard;
    const one = card.items[0]!;
    expect(one.source).toBe('ai');
    expect(one.foodId).toBeTruthy();
    expect(one.kcal).toBeCloseTo(195, 0);
    expect(one.per100g.protein).toBeCloseTo(3, 5); // 宏量没被库值覆盖
    expect(one.per100g.calcium).toBe(7); // 微量来自库
    expect(one.filled?.length).toBeGreaterThan(5);
    expect(card.caveats.join('')).not.toContain('微量参考');
  });

  it('名字带做法前缀时：宏量用 AI 的这盘菜，微量借库里同类食材', async () => {
    const foods = await allFoods();
    // 「无油煎鸡胸肉」对库里的「鸡胸肉」只有 0.571，整名匹配不上；
    // 库里那条是生食材 133 kcal，用户吃的是无油煎熟制 165 —— 整条换会倒退
    const card = resolveIntent(
      mealIntent([{ name: '无油煎鸡胸肉', grams: 100, per100g: { kcal: 165, protein: 31, fat: 4, carbs: 0 } }]),
      { foods, today: TODAY },
    ) as MealCard;
    const one = card.items[0]!;
    expect(one.source).toBe('ai');
    expect(one.kcal).toBeCloseTo(165, 0);
    expect(one.microFrom).toBe('鸡胸肉');
    expect(one.per100g.calcium).toBe(3);
    expect(one.filled?.length).toBeGreaterThan(5);
    expect(card.caveats.join('')).toContain('鸡胸肉');
  });

  it('库里没有才用 AI 估算', async () => {
    const foods = await allFoods();
    const card = resolveIntent(
      mealIntent([{ name: '外婆的神秘酱', grams: 50, per100g: { kcal: 200, protein: 5, fat: 18, carbs: 4 } }]),
      { foods, today: TODAY },
    ) as MealCard;
    expect(card.items[0]!.source).toBe('ai');
    expect(card.kcal).toBeCloseTo(100, 0);
    expect(card.items[0]!.foodId).toBeNull();
  });

  it('库里没有、AI 也没给热量 → 这一项不记，并写进 caveats', async () => {
    const foods = await allFoods();
    const card = resolveIntent(
      mealIntent([
        { name: '米饭', grams: 150 },
        { name: '不明物体', grams: 30 },
      ]),
      { foods, today: TODAY },
    ) as MealCard;
    expect(card.items).toHaveLength(1);
    // AI 一个数都没给时，库是唯一数据源 → 整条用库值（米饭 116×1.5）
    expect(card.items[0]!.source).toBe('preset');
    expect(card.items[0]!.kcal).toBeCloseTo(174, 0);
    expect(card.caveats.join('')).toContain('不明物体');
  });

  it('全都没数据时退回文字卡，不生成一张空的记账卡', async () => {
    const foods = await allFoods();
    const card = resolveIntent(mealIntent([{ name: '不明物体', grams: 30 }]), { foods, today: TODAY });
    expect(card.kind).toBe('text');
  });

  it('说"今天"就落到 today，非法日期也落到 today 并提示', async () => {
    const foods = await allFoods();
    const ok = resolveIntent(mealIntent([{ name: '米饭', grams: 150 }]), { foods, today: TODAY }) as MealCard;
    expect(ok.date).toBe(TODAY);

    const i = mealIntent([{ name: '米饭', grams: 150 }]);
    i.meal!.date = '2024-13-45';
    const bad = resolveIntent(i, { foods, today: TODAY }) as MealCard;
    expect(bad.date).toBe(TODAY);
    expect(bad.caveats.join('')).toContain('看不懂');
  });

  it('说"昨天"用模型给的日期', async () => {
    const foods = await allFoods();
    const i = mealIntent([{ name: '米饭', grams: 150 }]);
    i.meal!.date = '2026-10-21';
    const card = resolveIntent(i, { foods, today: TODAY }) as MealCard;
    expect(card.date).toBe('2026-10-21');
  });

  it('没说餐次时按当前时刻推断', async () => {
    const foods = await allFoods();
    const i = mealIntent([{ name: '米饭', grams: 150 }]);
    i.meal!.slot = null;
    const card = resolveIntent(i, {
      foods, today: TODAY, now: new Date(2026, 9, 22, 12, 30),
    }) as MealCard;
    expect(card.slot).toBe('lunch');
  });
});

describe('卡片内编辑', () => {
  it('改一份克数：营养值不变，per100g 跟着变', () => {
    const card = resolveIntent(hongshaorou(), { foods: [], today: TODAY }) as FoodCard;
    const bigger = withServingGrams(card, 500);
    expect(bigger.servingKcal).toBe(320);
    expect(bigger.per100g.kcal).toBeCloseTo(64, 5);
  });

  it('改热量：per100g 同步', () => {
    const card = resolveIntent(hongshaorou(), { foods: [], today: TODAY }) as FoodCard;
    const fixed = withServingValue(card, 'kcal', 400);
    expect(fixed.servingKcal).toBe(400);
    expect(fixed.per100g.kcal).toBeCloseTo(160, 5);
  });

  it('清空某项 → 回到 null，不是 0', () => {
    const card = resolveIntent(hongshaorou(), { foods: [], today: TODAY }) as FoodCard;
    const cleared = withServingValue(card, 'protein', null);
    expect(cleared.per100g.protein).toBeNull();
  });

  it('改记账里某项克数，合计跟着重算', async () => {
    const foods = await allFoods();
    const card = resolveIntent(
      baseIntent({
        type: 'log_meal',
        meal: { slot: 'lunch', date: null, items: [
          { name: '米饭', grams: 150, dish: null, per100g: null },
          { name: '鸡蛋', grams: 50, dish: null, per100g: null },
        ] },
      }),
      { foods, today: TODAY },
    ) as MealCard;
    const before = card.kcal;
    const after = withItemGrams(card, 0, 300);
    expect(after.items[0]!.grams).toBe(300);
    expect(after.kcal).toBeGreaterThan(before);
    // 另一项不受影响
    expect(after.items[1]!.grams).toBe(50);
  });
});

describe('applyCard —— 写库只有这一条路', () => {
  it('create_food 写入后优先级 100、per100g 正确', async () => {
    const card = resolveIntent(hongshaorou(), { foods: await allFoods(), today: TODAY }) as FoodCard;
    const res = await applyCard(card);
    expect(res.ok).toBe(true);
    expect(res.relatedFoodId).toBeTruthy();

    const customs = await customFoods();
    const saved = customs.find((f) => f.name === '妈妈牌红烧肉');
    expect(saved).toBeTruthy();
    expect(saved!.priority).toBe(100);
    expect(saved!.per100g.kcal).toBeCloseTo(128, 5);
    expect(saved!.serving).toEqual({ quantity: 1, unit: '碗', grams: 250 });
    expect(saved!.aliases).toContain('红烧肉');
  });

  it('存下来的自定义食物能被识别结果优先匹配到', async () => {
    const card = resolveIntent(hongshaorou(), { foods: await allFoods(), today: TODAY }) as FoodCard;
    await applyCard(card);

    const foods = await allFoods();
    const meal = resolveIntent(
      baseIntent({
        type: 'log_meal',
        meal: { slot: 'dinner', date: null, items: [
          { name: '红烧肉', grams: 200, dish: null, per100g: { kcal: 460 } },
        ] },
      }),
      { foods, today: TODAY },
    ) as MealCard;

    expect(meal.items[0]!.source).toBe('custom');
    // 200g 按 128 kcal/100g = 256，而不是内置「红烧肉」的 460×2=920
    expect(meal.kcal).toBeCloseTo(256, 0);
  });

  it('log_meal 落库成一条真正的餐次', async () => {
    const card = resolveIntent(
      baseIntent({
        type: 'log_meal',
        meal: { slot: 'lunch', date: null, items: [
          { name: '米饭', grams: 150, dish: null, per100g: null },
          { name: '鸡蛋', grams: 50, dish: null, per100g: null },
        ] },
      }),
      { foods: await allFoods(), today: TODAY },
    ) as MealCard;
    const res = await applyCard(card);
    expect(res.ok).toBe(true);

    const meals = await mealsOfDay(TODAY);
    expect(meals).toHaveLength(1);
    expect(meals[0]!.slot).toBe('lunch');
    expect(meals[0]!.items).toHaveLength(2);
    expect(meals[0]!.totals.kcal).toBeCloseTo(card.kcal, 0);
    // 快照必须自带营养值，渲染路径不 join 食物库
    expect(isKnown(meals[0]!.items[0]!.nutrition.kcal)).toBe(true);
  });

  it('文字卡不允许写库', async () => {
    const res = await applyCard({ kind: 'text', reply: '嗯', query: null, queryName: null });
    expect(res.ok).toBe(false);
    expect(await mealsOfDay(TODAY)).toHaveLength(0);
  });

  it('删除不存在的条目时明确失败，不静默通过', async () => {
    const card = resolveIntent(
      baseIntent({ type: 'delete_food', target: { name: '根本没有这个' } }),
      { foods: await allFoods(), today: TODAY },
    );
    expect(card.kind).toBe('text');
    if (card.kind === 'text') expect(card.reply).toContain('没找到');
  });

  it('内置食物不允许删', async () => {
    const card = resolveIntent(
      baseIntent({ type: 'delete_food', target: { name: '米饭' } }),
      { foods: await allFoods(), today: TODAY },
    );
    expect(card.kind).toBe('text');
    if (card.kind === 'text') expect(card.reply).toContain('内置');
  });

  it('自建食物可以删，且是软删（历史记录不受影响）', async () => {
    await applyCard(resolveIntent(hongshaorou(), { foods: await allFoods(), today: TODAY }) as FoodCard);
    const card = resolveIntent(
      baseIntent({ type: 'delete_food', target: { name: '妈妈牌红烧肉' } }),
      { foods: await allFoods(), today: TODAY },
    );
    expect(card.kind).toBe('delete_food');
    const res = await applyCard(card);
    expect(res.ok).toBe(true);
    expect(await customFoods()).toHaveLength(0);
  });
});

describe('改名场景不产生重复条目', () => {
  it('update_food 按旧名字定位，改名后库里仍只有一条', async () => {
    await applyCard(resolveIntent(hongshaorou(), { foods: await allFoods(), today: TODAY }) as FoodCard);
    const before = await customFoods();
    expect(before).toHaveLength(1);

    const renamed = baseIntent({
      type: 'update_food',
      target: { name: '妈妈牌红烧肉' },
      food: {
        name: '外婆牌红烧肉',
        aliases: ['红烧肉'],
        category: '家常菜',
        nutritionBasis: 'per_serving',
        serving: { quantity: 1, unit: '碗', grams: 250 },
        values: { kcal: 300, protein: 18, fat: 20, carbs: 12 },
      },
    });
    const card = resolveIntent(renamed, { foods: await allFoods(), today: TODAY }) as FoodCard;
    expect(card.existingId).toBe(before[0]!.id);
    expect(card.caveats.join('')).toContain('改名');

    const res = await applyCard(card);
    expect(res.ok).toBe(true);
    const after = await customFoods();
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe('外婆牌红烧肉');
    expect(after[0]!.id).toBe(before[0]!.id);
    // 学习信号跟着走，没被改名冲掉
    expect(after[0]!.per100g.kcal).toBeCloseTo(120, 5);
  });

  it('内置条目永远不会被自定义数据覆盖', async () => {
    const preset = (await allFoods()).find((f) => f.name === '米饭')!;
    const i = hongshaorou();
    i.food!.name = '米饭';
    i.food!.values = { kcal: 999 };
    const card = resolveIntent(i, { foods: await allFoods(), today: TODAY }) as FoodCard;
    await applyCard(card);

    const stillPreset = (await allFoods()).find((f) => f.id === preset.id)!;
    expect(stillPreset.per100g.kcal).toBe(116);
    expect(stillPreset.source).toBe('preset');
    // 用户那条以自定义身份并存
    expect((await customFoods()).some((f) => f.name === '米饭')).toBe(true);
  });
});

describe('聊天记录与待确认卡的生命周期', () => {
  it('发新消息会把还挂着的待确认卡全部作废', async () => {
    const { addChat, rejectPendingChats, recentChat } = await import('../db/repo');
    const base = {
      date: TODAY, role: 'assistant' as const, kind: 'intent_card' as const,
      text: '', intent: null, card: null, relatedMealId: null, relatedFoodId: null,
    };
    await addChat({ ...base, status: 'pending' });
    await addChat({ ...base, status: 'pending' });
    await addChat({ ...base, status: 'applied' });

    const n = await rejectPendingChats();
    expect(n).toBe(2);

    const msgs = await recentChat(10);
    expect(msgs.filter((m) => m.status === 'pending')).toHaveLength(0);
    // 已经保存成功的不能被误伤
    expect(msgs.filter((m) => m.status === 'applied')).toHaveLength(1);
  });

  it('消息按时间正序返回，界面才能直接渲染', async () => {
    const { addChat, recentChat } = await import('../db/repo');
    for (const t of ['第一句', '第二句', '第三句']) {
      await addChat({
        date: TODAY, role: 'user', kind: 'text', text: t, intent: null, card: null,
        status: null, relatedMealId: null, relatedFoodId: null,
      });
    }
    const msgs = await recentChat(10);
    expect(msgs.map((m) => m.text)).toEqual(['第一句', '第二句', '第三句']);
  });
});

describe('合餐折算 share', () => {
  /** 一锅 600g 青菜 + 2g 盐，模型按整份给克数 */
  function potMeal(share: number | null | undefined): Intent {
    return baseIntent({
      type: 'log_meal',
      meal: {
        slot: 'lunch',
        date: null,
        share,
        items: [
          { name: '炒青菜', grams: 600, dish: null, per100g: { kcal: 60, sodium: 50 } },
          { name: '食盐', grams: 2, dish: null, per100g: { kcal: 0, sodium: 39300 } },
        ],
      },
    });
  }

  it('没说吃了几成 → 原样记整份', async () => {
    const card = resolveIntent(potMeal(null), { foods: await allFoods(), today: TODAY }) as MealCard;
    expect(card.items[0]!.grams).toBe(600);
    expect(card.share).toBeNull();
  });

  it('三分之一：克数按 1/3 折，且 baseG 跟着落到吃到的量', async () => {
    const card = resolveIntent(potMeal(0.33), { foods: await allFoods(), today: TODAY }) as MealCard;
    expect(card.items[0]!.grams).toBe(204);
    expect(card.items[1]!.grams).toBe(0.7);
    // 咸淡三档锚在 baseG 上，若锚在整份，点「咸」会直接跳回锅里那份
    expect(card.items[1]!.baseG).toBe(0.7);
    expect(card.share).toBe('third');
  });

  it('卡片的合计是折算后的，不是整份', async () => {
    const whole = resolveIntent(potMeal(null), { foods: await allFoods(), today: TODAY }) as MealCard;
    const part = resolveIntent(potMeal(0.33), { foods: await allFoods(), today: TODAY }) as MealCard;
    expect(part.kcal).toBeLessThan(whole.kcal);
    expect(part.kcal / whole.kcal).toBeLessThan(0.4);
    expect(part.kcal / whole.kcal).toBeGreaterThan(0.3);
  });

  it('模型给得离谱（0.1 或 1）时不当「没吃」，按全部处理', async () => {
    for (const bad of [0.1, 1]) {
      const card = resolveIntent(potMeal(bad), { foods: await allFoods(), today: TODAY }) as MealCard;
      expect(card.share).toBeNull();
      expect(card.items[0]!.grams).toBe(600);
    }
  });

  it('折算后写库的克数就是吃到的量', async () => {
    const card = resolveIntent(potMeal(0.5), { foods: await allFoods(), today: TODAY }) as MealCard;
    const res = await applyCard(card);
    expect(res.ok).toBe(true);
    const meals = await mealsOfDay(TODAY);
    const it = meals[0]!.items.find((x) => x.name === '炒青菜');
    expect(it?.grams).toBe(300);
  });

  it('三档来回切换锚在整份上，不会连乘变小', async () => {
    const card = resolveIntent(potMeal(0.5), { foods: await allFoods(), today: TODAY }) as MealCard;
    const third = withShare(card, 'third');
    const half = withShare(third, 'half');
    const all = withShare(half, 'all');
    // 若在已缩小的克数上再乘，600 → 300 → 102 → 51，永远回不到 600
    expect(third.items[0]!.grams).toBe(204);
    expect(half.items[0]!.grams).toBe(300);
    expect(all.items[0]!.grams).toBe(600);
    expect(inferShare(all)).toBe('all');
  });

  it('折算只动克数，per100g 是食物本身的性质，不许被改', async () => {
    const card = resolveIntent(potMeal(0.33), { foods: await allFoods(), today: TODAY }) as MealCard;
    const salt = card.items.find((it) => it.name === '食盐')!;
    expect(salt.per100g.sodium).toBe(39300);
  });

  it('折算后的卡片会加一句说明，切回全部时把它收回去', async () => {
    const card = resolveIntent(potMeal(0.33), { foods: await allFoods(), today: TODAY }) as MealCard;
    expect(card.caveats.some((c) => c.includes('三分之一'))).toBe(true);
    const back = withShare(card, 'all');
    expect(back.caveats.some((c) => c.includes('已按「吃了'))).toBe(false);
  });
});
