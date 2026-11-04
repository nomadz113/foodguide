import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays } from '../../core/date';
import { allGoals, mealsInRange, weightsInRange } from '../../core/db/repo';
import {
  makeGoalResolver, periodRange, previousRange, smoothWeights, summarise, weightChange,
  type PeriodKind, type PeriodRange, type PeriodSummary, type WeightChange, type WeightPoint,
} from '../../core/report/period';
import { judge, type Verdict } from '../../core/report/verdict';
import type { GoalSnapshot } from '../../core/db/types';
import { useAppData } from '../../store/AppData';

const f0 = (n: number) => Math.round(n).toLocaleString();

export interface Bar {
  key: string;
  label: string;
  kcal: number | null;
  /** 该柱覆盖的有记录天数（季按 7 天聚合） */
  days: number;
  /** 是否是今天，X 轴上高亮出来 */
  isToday: boolean;
}

const DOW = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 柱粒度：周/月画每日柱，季按 7 天聚合。
 *
 * 90 根柱子在 390px 宽度下每根不到 4px，看不出任何形状，只能看出噪音，所以季要聚合。
 * 分组从窗口**末尾**往前切：末组恒为完整的「最近 7 天」，不足 7 天的那组落在最左边（最旧），
 * 这样 13 根柱互相可比，残缺的一组对判读影响最小。
 */
export function buildBars(s: PeriodSummary, kind: PeriodKind, today: string): Bar[] {
  const days = s.days;

  if (kind !== 'quarter') {
    // 30 根柱子挤不下 30 个日期，只每隔 5 天标一次；其余留空串以保住列对齐
    const everyN = kind === 'week' ? 1 : 5;
    const last = days.length - 1;
    return days.map((d, i) => ({
      key: d.day,
      label: (last - i) % everyN === 0
        ? (kind === 'week'
          ? DOW[new Date(`${d.day}T00:00:00`).getDay()] ?? ''
          : String(Number(d.day.slice(8))))
        : '',
      kcal: d.recorded ? d.kcal : null,
      days: d.recorded ? 1 : 0,
      isToday: d.day === today,
    }));
  }

  const G = 7;
  const bars: Bar[] = [];
  let end = days.length - 1;
  while (end >= 0) {
    const start = Math.max(0, end - G + 1);
    const slice = days.slice(start, end + 1);
    const rec = slice.filter((d) => d.recorded);
    const head = slice[0]!;
    const fromEnd = bars.length; // 已入组的数量：用于每隔一组标一次
    bars.unshift({
      key: head.day,
      label: fromEnd % 2 === 0
        ? `${Number(head.day.slice(5, 7))}/${Number(head.day.slice(8, 10))}`
        : '',
      kcal: rec.length > 0 ? rec.reduce((a, d) => a + d.kcal, 0) / rec.length : null,
      days: rec.length,
      isToday: slice.some((d) => d.day === today),
    });
    end = start - 1;
  }
  return bars;
}

export interface DietStatsView {
  goal: GoalSnapshot;
  s: PeriodSummary;
  p: PeriodSummary;
  change: WeightChange | null;
  points: WeightPoint[];
  verdict: Verdict;
  bars: Bar[];
  maxBar: number;
  targetPct: number;
  dense: boolean;
  deltaVsPrev: number | null;
  weekendDiff: number | null;
  weekendMonthKg: number | null;
  /** 头部那行摘要 */
  sub: string;
}

export interface DietStatsResult {
  kind: PeriodKind;
  changeKind: (k: PeriodKind) => void;
  offset: number;
  setOffset: (n: number) => void;
  range: PeriodRange;
  /** 窗口数据还没到时为 null */
  view: DietStatsView | null;
}

/**
 * 饮食分区的全部状态与派生。
 *
 * 跟 `useBpStats` 同一副骨架：所有 useMemo 都在任何早退之前跑完。
 * `useLiveQuery` 的 deps 只能是四个日期字符串 —— 换成 range 对象会让它拿到
 * 每次渲染都新的引用，查询永不停止。
 */
export function useDietStats(): DietStatsResult {
  const { goal, profile, today } = useAppData();
  const [kind, setKind] = useState<PeriodKind>('week');
  /** 0 = 截至今天；每 +1 整段窗口往前挪 PERIOD_DAYS[kind] 天。窗口由 today 派生，切日自动跟随 */
  const [offset, setOffset] = useState(0);

  const range = useMemo(() => periodRange(kind, offset, today), [kind, offset, today]);
  const prev = useMemo(() => previousRange(kind, offset, today), [kind, offset, today]);

  const data = useLiveQuery(async () => {
    const [meals, prevMeals, goals, weights] = await Promise.all([
      mealsInRange(range.from, range.to),
      mealsInRange(prev.from, prev.to),
      allGoals(),
      // 多取 7 天：移动平均在周期第一天需要用前几天的称重
      weightsInRange(addDays(range.from, -7), range.to),
    ]);
    return { meals, prevMeals, goals, weights };
  }, [range.from, range.to, prev.from, prev.to]);

  const view = useMemo<DietStatsView | null>(() => {
    const goalOf = makeGoalResolver(data?.goals ?? [], goal);
    if (!data) return null;

    const s = summarise(range, data.meals, goalOf);
    const p = summarise(prev, data.prevMeals, goalOf);
    // 滚动窗口末端就是今天，不需要再裁剪；移动平均仍需窗口前 7 天的称重
    const change = weightChange(data.weights, range.from, range.to);
    const points = smoothWeights(data.weights)
      .filter((x) => x.day >= range.from && x.day <= range.to);

    const verdict = judge({
      theoryKg: s.theoryKg,
      actualKg: change?.deltaKg ?? null,
      coverage: s.coverage,
      elapsedDays: s.elapsedDays,
      goalType: profile.goalType,
      proteinHitRate: s.recordedDays > 0 ? s.proteinHitDays / s.recordedDays : undefined,
    });

    const bars = buildBars(s, kind, today);

    /**
     * 纵轴上限。**只夹显示标度，不动任何数据**。
     *
     * 原来直接取 `max(目标×1.15, 最高的那天)`。问题是单日异常值（单位填错、一餐记成八餐、
     * 复用了别人的份量）会把上限顶到目标的 3~8 倍，于是这几天全被压成矮条 ——
     * 柱内数字要求柱高 ≥22% 才显示，一压缩就一个都不显示，而"某天数值离谱"正是
     * 最该被看见的那天。用户面对一排无数字的矮条，看不出这是异常还是正常波动。
     *
     * 所以上限夹到 `目标 × 2.5`：正常日（≤ 目标 ×2.5）的几何完全不受影响，
     * 只有真正超上限的那天才被封顶，并在柱顶画一道 `.clipped` 记号 + 原样保留数值。
     * 目标线位置仍在 13%~87% 之间，不会被顶出图外。
     */
    const dayMax = Math.max(0, ...bars.map((b) => b.kcal ?? 0));
    const maxBar = Math.min(
      Math.max(goal.kcal * 1.15, dayMax, 1),
      Math.max(goal.kcal * 2.5, 1),
    );

    const deltaVsPrev = s.avgKcal != null && p.avgKcal != null ? s.avgKcal - p.avgKcal : null;

    /** 周末规律的量化：每周 2 天、每月约 8 天，按 7700 kcal/kg 折算 */
    const weekendDiff = s.weekday && s.weekend ? s.weekend.avgKcal - s.weekday.avgKcal : null;

    return {
      goal,
      s,
      p,
      change,
      points,
      verdict,
      bars,
      maxBar,
      targetPct: (goal.kcal / maxBar) * 100,
      dense: bars.length >= 20,
      deltaVsPrev,
      weekendDiff,
      weekendMonthKg: weekendDiff == null ? null : (Math.abs(weekendDiff) * 8) / 7700,
      sub: `记录 ${s.recordedDays}/${s.elapsedDays} 天${s.avgKcal != null ? ` · 日均 ${f0(s.avgKcal)} kcal` : ''}`,
    };
  }, [data, range, prev, goal, profile.goalType, kind, today]);

  return {
    kind,
    changeKind: (k) => { setKind(k); setOffset(0); },
    offset,
    setOffset,
    range,
    view,
  };
}
