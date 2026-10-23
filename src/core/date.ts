/**
 * 日期/切日工具。
 *
 * 关键约定：一天的边界不是 0 点，而是用户设置的 dayStartHour（默认 4 点）。
 * 凌晨 1 点吃的夜宵应该算「昨天」，否则熬夜党每次都会被切开。
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

export const DEFAULT_DAY_START_HOUR = 4;

export function dayKey(input: Date | number = new Date(), dayStartHour = 0): string {
  const t = new Date(input);
  const shifted = new Date(t.getTime() - dayStartHour * 3_600_000);
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
}

/** 严格解析 YYYY-MM-DD 为本地 0 点，避免 new Date('2026-10-22') 被当成 UTC */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: string, n: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d, 0);
}

export function diffDays(from: string, to: string): number {
  const a = parseDayKey(from).getTime();
  const b = parseDayKey(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 周一为一周起点 */
export function weekStart(key: string): string {
  const d = parseDayKey(key);
  const dow = d.getDay(); // 0=周日
  return addDays(key, -(dow === 0 ? 6 : dow - 1));
}

export function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function quarterStart(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const qm = Math.floor(((m ?? 1) - 1) / 3) * 3 + 1;
  return `${y}-${pad2(qm)}-01`;
}

/** 生成 [from, to] 闭区间的日期序列 */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 2000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function formatDayLabel(key: string, today = dayKey(new Date(), DEFAULT_DAY_START_HOUR)): string {
  const d = diffDays(key, today);
  if (d === 0) return '今天';
  if (d === 1) return '昨天';
  if (d === -1) return '明天';
  const [y, m, day] = key.split('-').map(Number);
  const sameYear = (y ?? 0) === Number(today.slice(0, 4));
  return sameYear ? `${m} 月 ${day} 日` : `${y} 年 ${m} 月 ${day} 日`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 按当前时刻推断餐次 */
export function guessSlot(at: Date = new Date()): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = at.getHours();
  if (h >= 5 && h < 10) return 'breakfast';
  if (h >= 10 && h < 15) return 'lunch';
  if (h >= 16 && h < 21) return 'dinner';
  return 'snack';
}
