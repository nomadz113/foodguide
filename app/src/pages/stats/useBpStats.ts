import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { bpsInRange, softDeleteBp } from '../../core/db/repo';
import {
  BP_TARGET_DEFAULT, summariseBp, streakDays,
  type BpReading, type BpSummary,
} from '../../core/bp/engine';
import { buildBpSeries, groupSizeFor, movingAverage, type BpPoint } from '../../core/bp/trend';
import {
  periodRange, previousRange, type PeriodKind, type PeriodRange,
} from '../../core/report/period';
import { formatClock, formatDayLabel } from '../../core/date';
import type { BpEntry } from '../../core/db/types';
import { useAppData } from '../../store/AppData';

/**
 * 出移动平均的最低窗口长度。
 * 7 天窗口里 7 个点求平均，抹掉的就是全部细节；这里沿用进度页周末对比的同一个门槛。
 */
export const MA_MIN_SPAN = 14;

export interface BpStatsView {
  rows: BpEntry[];
  s: BpSummary;
  ps: BpSummary;
  points: BpPoint[];
  ma: (BpReading | null)[];
  groupSize: number;
  latest: BpEntry | null;
  streak: number;
  targetRate: number | null;
  prevMeanDelta: number | null;
  /** 头部那行摘要，供外壳直接显示 */
  sub: string;
}

export interface BpStatsResult {
  kind: PeriodKind;
  changeKind: (k: PeriodKind) => void;
  offset: number;
  setOffset: (n: number) => void;
  range: PeriodRange;
  /** 窗口数据还没到时为 null */
  view: BpStatsView | null;
  remove: (bp: BpEntry) => Promise<void>;
}

/**
 * 血压分区的全部状态与派生。
 *
 * 从 BpPage 里搬出来，是为了让「统计」页能把血压当成一个分区挂进去。
 * 所有 useMemo 都在任何早退之前跑完 —— 条件调用 hook 在运行时会直接抛错，
 * 而 tsc 拦不住（这个项目没有 ESLint）。
 */
export function useBpStats(): BpStatsResult {
  const { today } = useAppData();
  const [kind, setKind] = useState<PeriodKind>('month');
  /** 0 = 截至今天；每 +1 整段窗口往前挪 PERIOD_DAYS[kind] 天 */
  const [offset, setOffset] = useState(0);

  const range = useMemo(() => periodRange(kind, offset, today), [kind, offset, today]);
  const prev = useMemo(() => previousRange(kind, offset, today), [kind, offset, today]);

  const data = useLiveQuery(async () => {
    const [rows, prevRows] = await Promise.all([
      bpsInRange(range.from, range.to),
      bpsInRange(prev.from, prev.to),
    ]);
    return { rows, prevRows };
  }, [range.from, range.to, prev.from, prev.to]);

  const view = useMemo<BpStatsView | null>(() => {
    if (!data) return null;

    const s = summariseBp(data.rows, BP_TARGET_DEFAULT);
    const ps = summariseBp(data.prevRows, BP_TARGET_DEFAULT);

    const groupSize = groupSizeFor(range.elapsed.length);
    const points = buildBpSeries(range.elapsed, s.days, groupSize);
    // 分组后的点本身已经是 7 天均值，再平滑等于把噪声摊回平均值里
    const ma = range.elapsed.length >= MA_MIN_SPAN && groupSize === 1
      ? movingAverage(points, 7)
      : [];

    return {
      rows: data.rows,
      s,
      ps,
      points,
      ma,
      groupSize,
      latest: s.days.length > 0 ? data.rows[data.rows.length - 1]! : null,
      streak: streakDays(s.days.map((d) => d.date), range.to),
      targetRate: s.recordedDays > 0 ? s.onTargetDays / s.recordedDays : null,
      prevMeanDelta: s.mean && ps.mean ? s.mean.systolic - ps.mean.systolic : null,
      sub: s.recordedDays > 0
        ? `${s.recordedDays} 天有记录 · 平均 ${s.mean!.systolic}/${s.mean!.diastolic}`
        : '这段时间还没有记录',
    };
  }, [data, range]);

  async function remove(bp: BpEntry) {
    const when = `${formatDayLabel(bp.date, today)} ${formatClock(bp.measuredAt)}`;
    if (!window.confirm(`删除 ${when} 的这条血压记录？`)) return;
    await softDeleteBp(bp.id);
  }

  return {
    kind,
    changeKind: (k) => { setKind(k); setOffset(0); },
    offset,
    setOffset,
    range,
    view,
    remove,
  };
}
