import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IntakeDB, db } from '../db/schema';
import { addUserAlias, allFoods, ensureSeed, patchSettings, upsertFood } from '../db/repo';
import { facts } from '../nutrition/types';
import { MATCH_MIN } from './match';
import { normalizeName } from './normalize';
import {
  countOpenMisses, getMiss, guessCategory, isDishName, listMisses, medianGrams,
  reconcileMisses, recordMiss, setMissStatus, similarFoods,
} from './miss';

void IntakeDB;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const aiFacts = (kcal: number) => facts({ kcal, protein: 5, fat: 3, carbs: 10 });

describe('recordMiss —— 聚合与过滤', () => {
  it('同一个写法记两次只长一条，克数按顺序攒着', async () => {
    expect(await recordMiss({ name: '藕带', grams: 150, per100g: aiFacts(40) })).toBe('recorded');
    expect(await recordMiss({ name: ' 藕带 ', grams: 200, per100g: aiFacts(42) })).toBe('recorded');

    const m = await getMiss('藕带');
    expect(m?.count).toBe(2);
    expect(m?.grams).toEqual([150, 200]);
    expect(m?.per100g.kcal).toBe(42); // 用最近一次的 AI 值
    expect(await db.misses.count()).toBe(1);
  });

  it('单字名不记：既没有 bigram，又多半是识别碎片', async () => {
    expect(await recordMiss({ name: '虾', grams: 30 })).toBe('skip');
    expect(await recordMiss({ name: '  ', grams: 30 })).toBe('skip');
    expect(await db.misses.count()).toBe(0);
  });

  it('克数只留最近 10 次，不会无限膨胀', async () => {
    for (let i = 1; i <= 13; i++) await recordMiss({ name: '藕带', grams: i * 10 });
    const m = await getMiss('藕带');
    expect(m?.grams).toHaveLength(10);
    expect(m?.grams[9]).toBe(130);
  });

  it('食材与菜品分开归档', async () => {
    await recordMiss({ name: '藕带' });
    await recordMiss({ name: '红烧藕带' });
    expect((await getMiss('藕带'))?.kind).toBe('ingredient');
    expect((await getMiss('红烧藕带'))?.kind).toBe('dish');
    expect(await listMisses({ kinds: ['ingredient'] })).toHaveLength(1);
    expect(await listMisses({ kinds: ['dish'] })).toHaveLength(1);
  });
});

describe('recordMiss —— 自愈', () => {
  it('库里已经有的名字不记，并顺手把旧账销掉', async () => {
    await ensureSeed();
    const foods = await allFoods();

    // 先制造一条历史欠账（模拟"当时库里没有"）
    await recordMiss({ name: '米饭' });
    expect((await getMiss('米饭'))?.status).toBe('open');

    // 现在库里能命中了 → 再记一次不新增，且状态改成已覆盖
    expect(await recordMiss({ name: '米饭', foods })).toBe('hit');
    const m = await getMiss('米饭');
    expect(m?.status).toBe('added');
    expect(m?.count).toBe(1);
    expect(await countOpenMisses()).toBe(0);
  });

  it('reconcile 把"现在能命中"的待处理项批量销账', async () => {
    await ensureSeed();
    await recordMiss({ name: '米饭' });
    await recordMiss({ name: '完全不存在的东西' });
    expect(await countOpenMisses()).toBe(2);

    const closed = await reconcileMisses(await allFoods());
    expect(closed).toBe(1);
    expect((await getMiss('米饭'))?.status).toBe('added');
    expect((await getMiss('完全不存在的东西'))?.status).toBe('open');
  });

  it('用户忽略过的不会被自动重开，只累加次数', async () => {
    await recordMiss({ name: '藕带', grams: 100 });
    await setMissStatus(normalizeName('藕带'), 'dismissed');
    await recordMiss({ name: '藕带', grams: 120 });

    const m = await getMiss('藕带');
    expect(m?.status).toBe('dismissed');
    expect(m?.count).toBe(2);
    expect(await countOpenMisses()).toBe(0);
  });
});

describe('弱命中候选', () => {
  it('同一种菜的不同写法（雪里红/雪里蕻）能给出「最像的」候选', async () => {
    // 用自建条目造一个确定的相似度：两个三字名只共一个 bigram → 0.5，
    // 低于 0.62 的阈值（所以是缺口），又高于 0.45（所以值得提示）
    await upsertFood({ name: '雪里红', per100g: aiFacts(30), category: '蔬菜' });
    const foods = await allFoods();

    await recordMiss({ name: '雪里蕻', grams: 100, foods });
    const m = await getMiss('雪里蕻');
    expect(m?.near).not.toBeNull();
    expect(m?.near?.name).toBe('雪里红');
    expect(m?.near?.matched).toBe(false);
    expect(m?.near?.score ?? 0).toBeCloseTo(0.5, 2);
  });

  it('完全不像的名字不硬凑候选（宁可不提示也别瞎猜）', async () => {
    await ensureSeed();
    const foods = await allFoods();
    // 删掉单字别名「鱼」之后，草鱼和鲈鱼在 bigram 上一个共同项都没有
    await recordMiss({ name: '草鱼', grams: 200, foods });
    expect((await getMiss('草鱼'))?.near).toBeNull();
  });

  it('similarFoods 只返回够像的，且带 id 供加别名', async () => {
    await ensureSeed();
    const foods = await allFoods();
    const list = similarFoods('结球白菜', foods, 3);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBeTruthy();
    expect(similarFoods('zzz', foods)).toHaveLength(0);
  });
});

describe('addUserAlias —— 用户别名', () => {
  it('加别名后 findMatch 立刻认得，且不新建食物', async () => {
    await ensureSeed();
    const before = (await allFoods()).length;
    const cabbage = (await allFoods()).find((f) => f.name === '白菜');
    expect(cabbage).toBeTruthy();

    expect(await addUserAlias(cabbage!.id, '结球白菜')).toBe('ok');
    expect((await allFoods()).length).toBe(before);

    const { findMatch } = await import('./match');
    const hit = findMatch('结球白菜', await allFoods());
    expect(hit?.food.name).toBe('白菜');
    expect(hit?.score).toBeGreaterThanOrEqual(MATCH_MIN);
  });

  it('重复加、单字、被别人占用 都拒绝', async () => {
    await ensureSeed();
    const foods = await allFoods();
    const cabbage = foods.find((f) => f.name === '白菜')!;

    expect(await addUserAlias(cabbage.id, '白菜')).toBe('exists'); // 本来就是主名
    expect(await addUserAlias(cabbage.id, '鱼')).toBe('empty'); // 单字会吃掉同字食物
    expect(await addUserAlias(cabbage.id, '米饭')).toBe('conflict'); // 已被别的主名占用
    expect((await allFoods()).find((f) => f.name === '白菜')?.userAliases ?? []).toEqual([]);
  });

  it('种子库升级不会抹掉用户别名', async () => {
    await ensureSeed();
    const cabbage = (await allFoods()).find((f) => f.name === '白菜')!;
    await addUserAlias(cabbage.id, '结球白菜');

    // 把版本号回到 0，逼 ensureSeed 走完整的 toUpdate 分支
    await patchSettings({ seedVersion: 0 });
    await ensureSeed();

    const after = (await allFoods()).find((f) => f.name === '白菜');
    expect(after?.userAliases).toEqual(['结球白菜']);
  });

  it('条目不存在时返回 missing', async () => {
    expect(await addUserAlias('food_不存在', '大白菜')).toBe('missing');
  });
});

describe('分类与份量', () => {
  it('做法词判菜品，常见食材判食材', () => {
    for (const n of ['红烧排骨', '清炒藕带', '番茄炒蛋', '鸡蛋羹', '牛肉面']) {
      expect(isDishName(n), n).toBe(true);
    }
    for (const n of ['藕带', '西兰花', '鸡胸肉', '牛油果', '红腰豆']) {
      expect(isDishName(n), n).toBe(false);
    }
  });

  it('分类预填按关键词走，且水果/奶类优先于肉类', () => {
    expect(guessCategory('牛油果')).toBe('水果'); // 不能被「牛」带成蛋白
    expect(guessCategory('牛奶')).toBe('奶类');
    expect(guessCategory('草鱼')).toBe('蛋白');
    expect(guessCategory('豆角')).toBe('蔬菜');
    expect(guessCategory('燕麦')).toBe('主食');
    expect(guessCategory('完全不认识的名字')).toBe('自定义');
  });

  it('份量取中位数，不被一次大份带偏', () => {
    expect(medianGrams([100, 120, 900])).toBe(120);
    expect(medianGrams([100, 200])).toBe(150);
    expect(medianGrams([])).toBeNull();
  });
});

describe('入册后行为', () => {
  it('入册的自建条目能被匹配到（优先级 100）', async () => {
    await recordMiss({ name: '藕带', grams: 150, per100g: aiFacts(40) });
    const food = await upsertFood({
      name: '藕带',
      per100g: aiFacts(40),
      category: '蔬菜',
      serving: { quantity: 1, unit: '份', grams: 150 },
    });
    expect(food.source).toBe('custom');

    const { findMatch } = await import('./match');
    expect(findMatch('藕带', await allFoods())?.food.name).toBe('藕带');

    // 再记一次就会被自愈挡掉
    await recordMiss({ name: '藕带', foods: await allFoods() });
    expect((await getMiss('藕带'))?.count).toBe(1);
  });
});
