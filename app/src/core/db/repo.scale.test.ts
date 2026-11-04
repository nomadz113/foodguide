import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, IntakeDB } from './schema';
import { latestWeight, upsertWeight, upsertWeightScale } from './repo';

void IntakeDB;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('upsertWeightScale', () => {
  it('新日期写入体重与体脂率', async () => {
    const e = await upsertWeightScale('2026-10-24', 72.4, 22.8);
    expect(e.id).toBe('w_2026-10-24');
    expect(e.date).toBe('2026-10-24');
    expect(e.weightKg).toBe(72.4);
    expect(e.bodyFatPct).toBe(22.8);
  });

  it('**体脂率传 null 时保留当天原值** —— 这是它与 upsertWeight 的分水岭', async () => {
    await upsertWeightScale('2026-10-24', 72.4, 22.8);
    // 第二次只测到体重（截图里体脂率是 "--"）
    const e = await upsertWeightScale('2026-10-24', 72.1, null);
    expect(e.weightKg).toBe(72.1);
    expect(e.bodyFatPct).toBe(22.8);
    const rows = await db.weights.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bodyFatPct).toBe(22.8);
  });

  it('作为对照：upsertWeight 传 null 会把体脂率清掉（档案页主动清空时的正确行为）', async () => {
    await upsertWeight('2026-10-24', 72.4, 22.8);
    await upsertWeight('2026-10-24', 72.1, null);
    const rows = await db.weights.toArray();
    expect(rows[0]!.bodyFatPct).toBeNull();
  });

  it('读到新的体脂率时正常覆盖', async () => {
    await upsertWeightScale('2026-10-24', 72.4, 22.8);
    const e = await upsertWeightScale('2026-10-24', 72.0, 22.1);
    expect(e.bodyFatPct).toBe(22.1);
  });

  it('腰围与备注不丢：识别只负责体重体脂，不该顺手清掉用户手填的东西', async () => {
    await db.weights.put({
      id: 'w_2026-10-24',
      date: '2026-10-24',
      weightKg: 72.4,
      bodyFatPct: 22.8,
      waistCm: 84,
      note: '晨起排尿后',
      createdAt: 111,
    });
    const e = await upsertWeightScale('2026-10-24', 72.0, null);
    expect(e.waistCm).toBe(84);
    expect(e.note).toBe('晨起排尿后');
    expect(e.createdAt).toBe(111);
  });

  it('同一天写多次只有一条（&date 唯一索引），不是追加', async () => {
    await upsertWeightScale('2026-10-24', 72.4, 22.8);
    await upsertWeightScale('2026-10-24', 72.2, 22.6);
    await upsertWeightScale('2026-10-24', 72.0, 22.4);
    const rows = await db.weights.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.weightKg).toBe(72.0);
  });

  it('补录历史日期不会动档案要用的「今天」那条', async () => {
    await upsertWeightScale('2026-10-27', 72.0, 22.4);
    await upsertWeightScale('2026-10-24', 73.4, 23.1);
    const latest = await latestWeight();
    expect(latest?.date).toBe('2026-10-27');
    expect(latest?.weightKg).toBe(72.0);
  });
});

describe('latestWeight', () => {
  it('空表返回 null', async () => {
    expect(await latestWeight()).toBeNull();
  });

  it('多条时返回日期最大的一条，与写入顺序无关', async () => {
    await upsertWeightScale('2026-10-25', 73.1, null);
    await upsertWeightScale('2026-10-27', 72.0, 22.4);
    await upsertWeightScale('2026-10-24', 73.4, null);
    const latest = await latestWeight();
    expect(latest?.date).toBe('2026-10-27');
  });
});
