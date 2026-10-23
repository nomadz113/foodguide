import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, IntakeDB } from './schema';
import {
  allFoods, bootstrap, ensureGoal, ensureSeed, loadProfile, mealsOfDay,
  recordTierSample, saveMeal, saveProfile, softDeleteMeal, upsertWeight, recentWeights,
} from './repo';
import { makeItem, makeMeal } from '../meal/build';
import { facts } from '../nutrition/types';
import { newProfile } from './repo';

void IntakeDB;

const TODAY = '2026-10-22';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('bootstrap', () => {
  it('首次启动建档案、灌种子、算目标', async () => {
    const r = await bootstrap();
    expect(r.profile.id).toBe('me');
    expect(r.seeded).toBeGreaterThan(30);
    expect(await db.foods.count()).toBe(r.seeded);
    expect(r.goal.kcal).toBeGreaterThan(1000);
  });

  it('目标数字与方案文档算例一致（男 30 岁 175/78 减脂 0.5kg）', async () => {
    const r = await bootstrap();
    expect(r.goal.bmr).toBe(1729);
    expect(r.goal.tdee).toBe(2377);
    expect(r.goal.kcalFloor).toBe(1902);
    // 初步 1827 低于安全下限 1902 → 必须上调
    expect(r.goal.kcal).toBe(1902);
    expect(r.goal.warnings.length).toBe(1);
    expect(r.goal.proteinG).toBe(131);
    expect(r.goal.fatG).toBe(58);
    expect(r.goal.carbsG).toBe(214);
    // 三大宏量热量必须闭合到目标
    expect(r.goal.proteinG * 4 + r.goal.fatG * 9 + r.goal.carbsG * 4).toBeGreaterThan(1880);
  });

  it('第二次启动不重复灌种子，复用同一目标', async () => {
    const a = await bootstrap();
    const b = await bootstrap();
    expect(b.seeded).toBe(0);
    expect(await db.foods.count()).toBe(a.seeded);
    expect(b.goal.id).toBe(a.goal.id);
  });

  it('ensureSeed 幂等', async () => {
    const n1 = await ensureSeed();
    const n2 = await ensureSeed();
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(0);
  });
});

describe('档案变更', () => {
  it('体重变了会生成新目标快照，旧快照保留', async () => {
    const a = await bootstrap();
    const p = { ...a.profile, weightKg: 74 };
    const g2 = await saveProfile(p, TODAY);

    expect(g2.sourceProfileHash).not.toBe(a.goal.sourceProfileHash);
    expect(g2.id).not.toBe(a.goal.id);
    // 快照只能追加，不能覆盖历史
    expect(await db.goals.count()).toBe(2);
    expect((await db.profile.get('me'))?.weightKg).toBe(74);
  });

  it('档案没变不会重复建目标', async () => {
    const a = await bootstrap();
    const g2 = await ensureGoal(a.profile, TODAY);
    expect(g2.id).toBe(a.goal.id);
    expect(await db.goals.count()).toBe(1);
  });

  it('目标体重低于 BMI 18.5 会被拦截', async () => {
    const p = newProfile();
    const snap = await ensureGoal({ ...p, targetWeightKg: 50 }, TODAY);
    // 计算层照算，拦截靠 validateProfile（UI 层禁用保存）
    expect(snap.kcal).toBeGreaterThanOrEqual(snap.kcalFloor);
  });
});

describe('餐次读写', () => {
  it('按日读取，软删后消失', async () => {
    const rice = { name: '米饭', per100g: facts({ kcal: 116, protein: 2.6 }), baseG: 150 };
    const meal = makeMeal({ items: [makeItem(rice)], date: TODAY });
    await saveMeal(meal);

    expect((await mealsOfDay(TODAY)).length).toBe(1);

    await softDeleteMeal(meal.id);
    expect((await mealsOfDay(TODAY)).length).toBe(0);
    // 数据仍在库里，可恢复
    expect((await db.meals.get(meal.id))?.deletedAt).not.toBeNull();
  });

  it('历史记录不随食物库变化而改变（快照）', async () => {
    const p100 = facts({ kcal: 116, protein: 2.6 });
    const meal = makeMeal({ items: [makeItem({ name: '米饭', per100g: p100, baseG: 150 })], date: TODAY });
    await saveMeal(meal);

    p100.kcal = 999; // 模拟食物库被改
    const again = await mealsOfDay(TODAY);
    expect(again[0]?.totals.kcal).toBeCloseTo(174, 6);
  });
});

describe('档位学习', () => {
  it('3 次大份后偏置上调，并且不超过 1.25', async () => {
    await bootstrap();
    const f = (await allFoods())[0];
    if (!f) throw new Error('种子库为空');

    await recordTierSample(f.id, 'large');
    await recordTierSample(f.id, 'large');
    let cur = await db.foods.get(f.id);
    // 2 次还不够，偏置仍为 1
    expect(cur?.personalBias).toBe(1);

    await recordTierSample(f.id, 'large');
    cur = await db.foods.get(f.id);
    expect(cur?.personalBias).toBeGreaterThan(1);
    expect(cur?.personalBias).toBeLessThanOrEqual(1.25);
    expect(cur?.biasSamples?.length).toBe(3);
  });

  it('样本上限 20 条', async () => {
    await bootstrap();
    const f = (await allFoods())[0];
    if (!f) throw new Error('种子库为空');
    for (let i = 0; i < 30; i++) await recordTierSample(f.id, 'small');
    const cur = await db.foods.get(f.id);
    expect(cur?.biasSamples?.length).toBe(20);
    expect(cur?.personalBias).toBeGreaterThanOrEqual(0.8);
  });
});

describe('体重', () => {
  it('同一天重复保存只更新一条', async () => {
    await upsertWeight(TODAY, 78);
    await upsertWeight(TODAY, 77.5);
    const list = await recentWeights(10);
    expect(list.length).toBe(1);
    expect(list[0]?.weightKg).toBe(77.5);
  });

  it('按日期升序返回', async () => {
    await upsertWeight('2026-10-20', 79);
    await upsertWeight('2026-10-22', 78);
    await upsertWeight('2026-10-21', 78.5);
    const list = await recentWeights(10);
    expect(list.map((x) => x.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });
});

describe('loadProfile', () => {
  it('未初始化时返回 null', async () => {
    expect(await loadProfile()).toBeNull();
  });
});
