import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import { bpsInRange, bpsOfDay, latestBp, putBp, recentBps, restoreBp, softDeleteBp } from './repo';
import type { BpInput } from './repo';

/**
 * 血压表的读写。
 *
 * 这里最值得测的不是「存得进去」，而是两件事：
 * 1. 软删的记录必须真的从每一个查询里消失 —— 漏一个 filter，用户就会看到已删除的记录复活。
 * 2. 改一条记录时 createdAt 不能被重写：它是「什么时候记的」的唯一凭据。
 */
function input(date: string, hour: number, systolic: number, diastolic: number, extra: Partial<BpInput> = {}): BpInput {
  return {
    measuredAt: new Date(`${date}T${`${hour}`.padStart(2, '0')}:00:00`).getTime(),
    date,
    systolic,
    diastolic,
    source: 'manual',
    timeSource: 'now',
    ...extra,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('putBp', () => {
  it('新建：补上没有给的字段', async () => {
    const e = await putBp(input('2026-10-26', 8, 128, 84));
    expect(e.id).toBeTruthy();
    expect(e.pulse).toBeNull();
    expect(e.flags).toBeNull();
    expect(e.aiMeta).toBeNull();
    expect(e.deletedAt).toBeNull();
    expect(await db.bps.count()).toBe(1);
  });

  it('改一条已有的：保留 createdAt 与 deletedAt，只动 updatedAt', async () => {
    const a = await putBp(input('2026-10-26', 8, 128, 84));
    const b = await putBp(input('2026-10-26', 8, 130, 86, { id: a.id }));
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.systolic).toBe(130);
    expect(b.updatedAt).toBeGreaterThanOrEqual(a.updatedAt);
    expect(await db.bps.count()).toBe(1); // 是改不是新增
  });

  it('纠正读数后 timeSource 要能改成 user', async () => {
    const a = await putBp(input('2026-10-26', 8, 128, 84, { timeSource: 'exif' }));
    const b = await putBp(input('2026-10-26', 8, 128, 84, { id: a.id, timeSource: 'user' }));
    expect(b.timeSource).toBe('user');
  });
});

describe('软删', () => {
  it('删除后从所有查询里消失，恢复后又回来', async () => {
    const e = await putBp(input('2026-10-26', 8, 128, 84));
    await softDeleteBp(e.id);

    expect(await latestBp()).toBeNull();
    expect(await bpsOfDay('2026-10-26')).toHaveLength(0);
    expect(await bpsInRange('2026-10-01', '2026-10-31')).toHaveLength(0);
    expect(await recentBps()).toHaveLength(0);

    await restoreBp(e.id);
    expect(await latestBp()).not.toBeNull();
  });

  it('删一条不存在的 id 不报错也不改动别的数据', async () => {
    const e = await putBp(input('2026-10-26', 8, 128, 84));
    await softDeleteBp('不存在的 id');
    await restoreBp('不存在的 id');
    expect(await recentBps()).toHaveLength(1);
    expect(e.id).toBeTruthy();
  });
});

describe('查询', () => {
  beforeEach(async () => {
    await putBp(input('2026-10-24', 8, 120, 78));
    await putBp(input('2026-10-25', 8, 130, 82));
    // 熬夜到凌晨 1 点：归档日仍是前一天，但真实时刻最晚 —— 必须按 measuredAt 判"最近"
    await putBp(input('2026-10-26', 8, 140, 90));
    await putBp(input('2026-10-27', 1, 118, 76));
  });

  it('latestBp 取真实时刻最晚的那条', async () => {
    const last = await latestBp();
    expect(last?.date).toBe('2026-10-27');
    expect(last?.systolic).toBe(118);
  });

  it('bpsOfDay 按时刻升序，同一天多条也对', async () => {
    await putBp(input('2026-10-26', 20, 150, 95));
    const rows = await bpsOfDay('2026-10-26');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.systolic).toBe(140);
    expect(rows[1]!.systolic).toBe(150);
  });

  it('bpsInRange 两端都包含', async () => {
    expect(await bpsInRange('2026-10-25', '2026-10-26')).toHaveLength(2);
    expect(await bpsInRange('2026-10-24', '2026-10-27')).toHaveLength(4);
    expect(await bpsInRange('2026-11-01', '2026-11-30')).toHaveLength(0);
  });

  it('recentBps 返回时刻升序（最早的在前，画趋势图用）', async () => {
    const rows = await recentBps();
    expect(rows[0]!.date).toBe('2026-10-24');
    expect(rows[rows.length - 1]!.date).toBe('2026-10-27');
  });

  /**
   * datetime-local 只有分钟精度：同一分钟连记两条，measuredAt 完全相同。
   * 若排序到此为止，胜负就交给主键（随机 nanoid）—— 用户会看到「刚记的那条不见了」，
   * 而且下次刷新可能又出现。这条测试是把"最近一次"的定义钉死：同时刻比谁晚写。
   */
  it('同一分钟记两条：latestBp 取后写的那条，而不是随机一条', async () => {
    await db.delete();
    await db.open();

    const t0 = Date.parse('2026-10-27T08:30:00');
    let clock = t0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);

    try {
      await putBp(input('2026-10-27', 8, 120, 78, { measuredAt: t0 }));
      clock += 5_000;
      await putBp(input('2026-10-27', 8, 145, 92, { measuredAt: t0 }));

      const last = await latestBp();
      expect(last?.createdAt).toBe(t0 + 5_000);
      expect(last?.systolic).toBe(145);

      // 列表也同口径：早写的在前，晚写的在后
      const rows = await bpsOfDay('2026-10-27');
      expect(rows.map((r) => r.systolic)).toEqual([120, 145]);
    } finally {
      spy.mockRestore();
    }
  });

  it('写入更晚但测量更早的一条，不能抢走「最近一次」', async () => {
    await db.delete();
    await db.open();

    const early = Date.parse('2026-10-27T07:00:00');
    const late = Date.parse('2026-10-27T09:00:00');
    let clock = Date.parse('2026-10-27T10:00:00');
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);

    try {
      await putBp(input('2026-10-27', 9, 132, 85, { measuredAt: late }));
      clock += 60_000; // 后来才补记早上那条
      await putBp(input('2026-10-27', 7, 118, 74, { measuredAt: early }));

      expect((await latestBp())?.systolic).toBe(132);
    } finally {
      spy.mockRestore();
    }
  });
});
