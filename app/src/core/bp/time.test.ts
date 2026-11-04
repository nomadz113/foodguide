import { describe, expect, it } from 'vitest';
import { clampFuture, MAX_FUTURE_SKEW_MS, pickBpTime } from './time';
import type { TakenAtResult } from '../media/takenAt';

/** 2026-10-26 20:15 本地时间 */
const FALLBACK_MS = new Date(2026, 9, 26, 20, 15, 0, 0).getTime();

function exif(): TakenAtResult {
  return { takenAt: FALLBACK_MS, source: 'exif', raw: '2026:10:26 20:15:00' };
}

describe('pickBpTime：时间溯源优先级', () => {
  it('屏幕上的时间赢过 EXIF —— 补录三天前的记录必须归到三天前', () => {
    const r = pickBpTime('2026-10-23 08:12', exif());
    expect(r.source).toBe('display');
    const d = new Date(r.measuredAt);
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(12);
  });

  it('读不到屏幕时间就用 EXIF，来源如实标注', () => {
    const r = pickBpTime(null, exif());
    expect(r).toEqual({ measuredAt: FALLBACK_MS, source: 'exif' });
  });

  it('屏幕时间只有时钟没有日期时，日期用 EXIF 那天补', () => {
    const r = pickBpTime('????-??-?? 08:12', exif());
    expect(r.source).toBe('display');
    const d = new Date(r.measuredAt);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(8);
  });

  it('屏幕时间是乱串时退回 EXIF，而不是抛错', () => {
    expect(pickBpTime('看不清', exif()).source).toBe('exif');
    expect(pickBpTime('2026/10/26 08:12', exif()).source).toBe('exif');
    expect(pickBpTime('2026-10-26 25:12', exif()).source).toBe('exif');
  });

  it('兜底本身走到 now 时，来源照样传出去', () => {
    const now = Date.now();
    const r = pickBpTime(null, { takenAt: now, source: 'now' });
    expect(r).toEqual({ measuredAt: now, source: 'now' });
  });

  it('文件名兜底不会被误标成 EXIF', () => {
    const r = pickBpTime(null, { takenAt: FALLBACK_MS, source: 'filename', raw: 'IMG_20261026_201500' });
    expect(r.source).toBe('filename');
  });
});

describe('pickBpTime：未来时刻', () => {
  it('屏幕显示明显未来的时间 → 夹回现在，且来源改标 now', () => {
    const now = Date.now();
    const later = new Date(now + 3 * 3_600_000);
    const stamp = [
      later.getFullYear(),
      String(later.getMonth() + 1).padStart(2, '0'),
      String(later.getDate()).padStart(2, '0'),
    ].join('-');
    const hh = String(later.getHours()).padStart(2, '0');
    const mi = String(later.getMinutes()).padStart(2, '0');

    const r = pickBpTime(`${stamp} ${hh}:${mi}`, exif());
    expect(r.measuredAt).toBe(now);
    // 来源必须跟着改：声称「屏显」就等于替一台时钟错乱的机器背书
    expect(r.source).toBe('now');
  });

  it('一小时内的小偏差放行，来源仍然算屏显', () => {
    const soon = new Date(Date.now() + 20 * 60_000);
    const stamp = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    const hh = String(soon.getHours()).padStart(2, '0');
    const mi = String(soon.getMinutes()).padStart(2, '0');
    expect(pickBpTime(`${stamp} ${hh}:${mi}`, exif()).source).toBe('display');
  });
});

describe('clampFuture', () => {
  const now = new Date(2026, 9, 26, 12, 0, 0, 0).getTime();

  it('正常过去时刻原样返回', () => {
    expect(clampFuture(now - 3_600_000, now)).toBe(now - 3_600_000);
  });

  it('时钟偏快在一小时内放行（相机时区常见）', () => {
    expect(clampFuture(now + MAX_FUTURE_SKEW_MS - 1, now)).toBe(now + MAX_FUTURE_SKEW_MS - 1);
  });

  it('明显来自未来的时刻退到现在', () => {
    expect(clampFuture(now + 3 * 3_600_000, now)).toBe(now);
  });
});
