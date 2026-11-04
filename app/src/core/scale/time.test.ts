import { describe, expect, it, vi } from 'vitest';
import { pickScaleTime, shouldSyncProfile } from './time';

const ymd = (t: number) => {
  const d = new Date(t);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

describe('pickScaleTime', () => {
  it('页面时间优先于文件时间，来源标 display', () => {
    const fallback = { takenAt: new Date(2026, 9, 27, 10, 0).getTime(), source: 'mtime' as const };
    const r = pickScaleTime('2026-10-24 07:35', fallback);
    expect(ymd(r.measuredAt)).toEqual([2026, 10, 24]);
    expect(r.source).toBe('display');
  });

  it('**相对时间的基准是文件时间，不是现在** —— 三天前截的图，「今天」是三天前的今天', () => {
    const shotAt = new Date(2026, 9, 24, 9, 0).getTime();
    const r = pickScaleTime('今天 08:12', { takenAt: shotAt, source: 'mtime' });
    expect(ymd(r.measuredAt)).toEqual([2026, 10, 24]);
    expect(new Date(r.measuredAt).getHours()).toBe(8);
    expect(r.source).toBe('display');
  });

  it('「昨天」相对文件时间再退一天', () => {
    const shotAt = new Date(2026, 9, 27, 20, 0).getTime();
    const r = pickScaleTime('昨天 21:05', { takenAt: shotAt, source: 'mtime' });
    expect(ymd(r.measuredAt)).toEqual([2026, 10, 26]);
    expect(new Date(r.measuredAt).getHours()).toBe(21);
  });

  it('页面时间读不出时退回文件时间，并如实沿用它的来源', () => {
    const shotAt = new Date(2026, 9, 27, 10, 0).getTime();
    expect(pickScaleTime(null, { takenAt: shotAt, source: 'exif' }).source).toBe('exif');
    expect(pickScaleTime('08:12', { takenAt: shotAt, source: 'mtime' }).source).toBe('mtime');
    expect(pickScaleTime('上周', { takenAt: shotAt, source: 'filename' }).source).toBe('filename');
  });

  it('未来时间被夹回现在，来源降级为 now（不能声称来自页面）', () => {
    const shotAt = new Date(2026, 9, 27, 10, 0).getTime();
    const future = new Date(Date.now() + 5 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const text = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())} 08:00`;
    const r = pickScaleTime(text, { takenAt: shotAt, source: 'mtime' });
    expect(r.source).toBe('now');
    expect(Date.now() - r.measuredAt).toBeLessThan(5_000);
  });

  it('没有时间文字也没有文件时间信息时，落到 now', () => {
    const r = pickScaleTime(null, { takenAt: Date.now(), source: 'now' });
    expect(r.source).toBe('now');
  });
});

/**
 * 页面只印日期的情况（Keep 列表页就是这样）。
 * 提需求的原话：「日期是准的，但时间是 0 点 0 分」——
 * 0:00 不是量出来的，是 makeTime 缺时分时的占位符，必须换成截图时间的时分。
 */
describe('pickScaleTime · 页面只印了日期', () => {
  const shotAt = new Date(2026, 9, 27, 14, 32).getTime();

  it('时分借截图时间，日期仍是页面上的那天，并标记 clockFromFile', () => {
    const r = pickScaleTime('10月24日', { takenAt: shotAt, source: 'mtime' });
    expect(ymd(r.measuredAt)).toEqual([2026, 10, 24]);
    expect(new Date(r.measuredAt).getHours()).toBe(14);
    expect(new Date(r.measuredAt).getMinutes()).toBe(32);
    expect(r.clockFromFile).toBe(true);
    expect(r.source).toBe('display');
  });

  it('**只借时分、不借日期** —— 文件时间晚三天，日期不能被带跑', () => {
    const r = pickScaleTime('10月24日', {
      takenAt: new Date(2026, 9, 27, 8, 0).getTime(),
      source: 'mtime',
    });
    expect(ymd(r.measuredAt)).toEqual([2026, 10, 24]);
    expect(new Date(r.measuredAt).getHours()).toBe(8);
  });

  it('「今天」没带时分时，同样只补时分', () => {
    const r = pickScaleTime('今天', {
      takenAt: new Date(2026, 9, 24, 9, 15).getTime(),
      source: 'mtime',
    });
    expect(ymd(r.measuredAt)).toEqual([2026, 10, 24]);
    expect(new Date(r.measuredAt).getHours()).toBe(9);
    expect(r.clockFromFile).toBe(true);
  });

  it('页面印了准确时分就不借，clockFromFile 为 false', () => {
    const r = pickScaleTime('10月24日 07:35', { takenAt: shotAt, source: 'mtime' });
    expect(new Date(r.measuredAt).getHours()).toBe(7);
    expect(new Date(r.measuredAt).getMinutes()).toBe(35);
    expect(r.clockFromFile).toBe(false);
  });

  it('借来的时分把时刻推到未来时，夹回现在且不再声称时分来自截图', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 10, 0));
    try {
      // 页面「10月27日」+ 文件时分 23:50 → 10-27 23:50，而现在是 10 点
      const r = pickScaleTime('10月27日', {
        takenAt: new Date(2026, 9, 26, 23, 50).getTime(),
        source: 'mtime',
      });
      expect(r.source).toBe('now');
      expect(r.clockFromFile).toBe(false);
      expect(Date.now() - r.measuredAt).toBeLessThan(5_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shouldSyncProfile', () => {
  it('还没有任何体重记录时更新档案', () => {
    expect(shouldSyncProfile('2026-10-24', null)).toBe(true);
  });

  it('今天或更晚的测量更新档案', () => {
    expect(shouldSyncProfile('2026-10-27', '2026-10-27')).toBe(true);
    expect(shouldSyncProfile('2026-10-28', '2026-10-27')).toBe(true);
  });

  it('**补录历史只进趋势，不改档案**', () => {
    expect(shouldSyncProfile('2026-10-24', '2026-10-27')).toBe(false);
  });

  it('跨月跨年也按时间比（定长 YYYY-MM-DD 的字典序等于时间序）', () => {
    expect(shouldSyncProfile('2026-09-30', '2026-10-01')).toBe(false);
    expect(shouldSyncProfile('2027-01-01', '2026-12-31')).toBe(true);
  });
});
