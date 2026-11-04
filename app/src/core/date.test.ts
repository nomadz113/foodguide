import { describe, expect, it } from 'vitest';
import { addDays, dayKey, dayRange, formatDayLabel, monthStart, quarterStart, weekStart } from './date';

const at = (s: string) => new Date(`${s}`);

describe('dayKey 切日', () => {
  it('默认 0 点切日', () => {
    expect(dayKey(at('2026-10-22T23:30:00'))).toBe('2026-10-22');
    expect(dayKey(at('2026-10-22T00:10:00'))).toBe('2026-10-22');
  });

  it('dayStartHour=4 时，凌晨 2 点算前一天', () => {
    expect(dayKey(at('2026-10-22T02:30:00'), 4)).toBe('2026-10-21');
    expect(dayKey(at('2026-10-22T04:00:00'), 4)).toBe('2026-10-22');
    expect(dayKey(at('2026-10-22T23:59:00'), 4)).toBe('2026-10-22');
  });

  it('跨年边界', () => {
    expect(dayKey(at('2027-01-01T01:00:00'), 4)).toBe('2026-12-31');
  });
});

describe('日期游走', () => {
  it('addDays 处理月末与跨年', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weekStart 取周一', () => {
    // 2026-10-22 是周四
    expect(weekStart('2026-10-22')).toBe('2026-10-19');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    // 周日应回到上一周的周一
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
  });

  it('monthStart / quarterStart', () => {
    expect(monthStart('2026-10-22')).toBe('2026-10-01');
    expect(quarterStart('2026-10-22')).toBe('2026-10-01');
    expect(quarterStart('2026-02-10')).toBe('2026-01-01');
    expect(quarterStart('2026-08-31')).toBe('2026-07-01');
  });

  it('dayRange 含首尾', () => {
    const r = dayRange('2026-10-20', '2026-10-22');
    expect(r).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });
});

describe('文案', () => {
  it('今天/昨天/明天', () => {
    expect(formatDayLabel('2026-10-22', '2026-10-22')).toBe('今天');
    expect(formatDayLabel('2026-10-21', '2026-10-22')).toBe('昨天');
    expect(formatDayLabel('2026-10-23', '2026-10-22')).toBe('明天');
  });

  it('同年只显示月日，跨年带年份', () => {
    expect(formatDayLabel('2026-03-05', '2026-10-22')).toBe('3 月 5 日');
    expect(formatDayLabel('2025-03-05', '2026-10-22')).toBe('2025 年 3 月 5 日');
  });
});
