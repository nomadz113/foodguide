/**
 * 血压趋势序列（纯函数，无 IO）。
 *
 * 把「窗口内的记录」变成「图上能画的点」。三个刻意的选择：
 *
 * 1. **聚合单位是「天」而不是「条」**。一天测三次的人如果按条计入，
 *    他在「这个月的平均」里就有三倍权重 —— 而一天测多次通常正是因为读数不稳，
 *    等于让最不稳的数据主导结论。所以天内部先合成当天均值（summariseBp 已做），
 *    组之间再对**天数**平均，不管那一天测了几次。
 * 2. **没测的日子是断点，不是插值**。周三测了、周五测了，中间没有数据就是没有数据。
 *    把两点连起来画出的那条线段是凭空生出来的，而用户会当它是真实趋势。
 *    所以这里每个点都保留 `reading: null` 的可能，折线由画图那层负责断开。
 * 3. **90 天窗口按 7 天分组，且从窗口末尾往前对齐**。90 个点挤在手机宽度上是像素噪声；
 *    但按自然周对齐会导致每过一天所有组的边界都挪一天，昨天看过的形状今天就对不上，
 *    所以固定「最后一组 = 最近 7 天」。
 */

import { meanReading, type BpReading } from './engine';

export interface BpPoint {
  /** 组内首日，同时作为 React key 与 x 轴坐标来源 */
  key: string;
  from: string;
  to: string;
  label: string;
  reading: BpReading | null;
  /** 组内实际有记录的天数。1 天撑出来的 7 天均值不该和 7 天满量程同权重展示 */
  days: number;
}

/** 超过这个点数就按周聚合：再密下去相邻点间距不足 4px，形状读不出来 */
export const SERIES_MAX_POINTS = 30;

/** 移动平均的最小样本数。2 个点取平均等于连线中点，是在制造数据 */
export const MA_MIN_POINTS = 3;

export function groupSizeFor(dayCount: number): number {
  return dayCount > SERIES_MAX_POINTS ? 7 : 1;
}

function shortLabel(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${m}/${d}`;
}

/**
 * 生成序列。
 *
 * @param elapsed  窗口内已经过去的日子（升序），决定 x 轴刻度
 * @param daily    有记录的那些天的当天均值
 * @param groupSize 1 = 每天一个点；7 = 每 7 天一个点
 */
export function buildBpSeries(
  elapsed: string[],
  daily: { date: string; reading: BpReading }[],
  groupSize = 1,
): BpPoint[] {
  const n = Math.max(1, Math.floor(groupSize) || 1);
  const byDate = new Map<string, BpReading>();
  for (const d of daily) byDate.set(d.date, d.reading);

  const groups: string[][] = [];
  if (n === 1) {
    for (const day of elapsed) groups.push([day]);
  } else {
    // 从末尾往前切：最后一组恒为「最近 n 天」
    const bucket: string[][] = [];
    for (let i = elapsed.length; i > 0; ) {
      const from = Math.max(0, i - n);
      bucket.push(elapsed.slice(from, i));
      i = from;
    }
    for (let i = bucket.length - 1; i >= 0; i -= 1) groups.push(bucket[i]!);
  }

  return groups.map((g) => {
    const hits = g.filter((d) => byDate.has(d)).map((d) => byDate.get(d)!);
    return {
      key: g[0]!,
      from: g[0]!,
      to: g[g.length - 1]!,
      label: shortLabel(g[0]!),
      reading: meanReading(hits),
      days: hits.length,
    };
  });
}

/**
 * n 日移动平均，与 points 等长。
 *
 * 单次血压的日间波动 ±10mmHg 是常态（没静息够、刚爬完楼、袖带偏一点）。
 * 每天一个点画出来全是锯齿，用户会读成「完全没控制住」；只画平滑线又会抹掉
 * 真实的抬升。所以点和线两层一起画 —— 和体重图同一套做法。
 *
 * 窗口里有效点不足 MA_MIN_POINTS 就返回 null：那几个点的平均值代表不了任何东西。
 */
export function movingAverage(
  points: BpPoint[],
  windowSize = 7,
): (BpReading | null)[] {
  return points.map((_, i) => {
    const from = Math.max(0, i - windowSize + 1);
    const hits = points
      .slice(from, i + 1)
      .map((p) => p.reading)
      .filter((r): r is BpReading => r != null);
    if (hits.length < MA_MIN_POINTS) return null;
    return meanReading(hits);
  });
}

/**
 * 把序列切成若干「连续有值」的段，返回每段的下标与值。
 *
 * 画图时对每段画一条 polyline，而不是整序列一条 ——
 * 一条到底的话，跨越空缺的那一段线就是凭空生出来的。
 *
 * 返回下标而不是日期：调用方要用下标换算 x 坐标，存日期再回头 findIndex 是 O(n²)。
 */
export function splitGaps<T>(values: (T | null)[]): { pts: { i: number; v: T }[] }[] {
  const out: { pts: { i: number; v: T }[] }[] = [];
  let cur: { i: number; v: T }[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null || v === undefined) {
      if (cur.length > 0) out.push({ pts: cur });
      cur = [];
      continue;
    }
    cur.push({ i, v });
  }
  if (cur.length > 0) out.push({ pts: cur });
  return out;
}
