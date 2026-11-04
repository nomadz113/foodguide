/**
 * 周期聚合（纯函数，无 IO）。
 *
 * 三条刻意坚持的规则：
 * 1. **null ≠ 0**：某天没记录，那天就是 null，不参与任何平均值。
 * 2. **分母是「有记录的天」而不是日历天**：只记了 3 天却拿 7 除，会把依从性差
 *    误算成「吃得很少」，进而推出错误的体重变化。
 * 3. **微量单独判可信度**：AI 只给宏量，微量靠食物库补，覆盖不足的项不进缺口榜，
 *    否则「你这周缺 VC」可能只是那几天没匹配上食物库。
 */

import { addDays, dayRange, parseDayKey } from '../date';
import type { GoalSnapshot, Meal, WeightEntry } from '../db/types';
import {
  MICRO_KEYS, NUTRIENT_LABELS,
  isKnown,
  type MicroKey, type NutrientKey, type NutritionFacts,
} from '../nutrition/types';

export type PeriodKind = 'week' | 'month' | 'quarter';

export interface PeriodRange {
  kind: PeriodKind;
  from: string;
  to: string;
  /** 窗口内的全部天数。滚动窗口 to ≤ today，所以它等于 dayRange(from, to)；保留过滤是为了防御未来日期 */
  elapsed: string[];
  label: string;
}

/** 滚动窗口长度（天）。周/月/季不再是自然周/自然月/自然季度 */
export const PERIOD_DAYS: Record<PeriodKind, number> = { week: 7, month: 30, quarter: 90 };

function shortDate(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

/**
 * 滚动窗口：offset = 0 表示「截至今天」，offset = 1 表示整段再往前挪 N 天。
 *
 * 用自然周/自然月的问题是周期刚开始时窗口几乎是空的：周一打开「周」视图，
 * 本周只过去 1 天，图上就只有 1 根柱子，看不出任何趋势。滚动窗口长度恒定，
 * 任何时候打开都有完整的 N 天可比。
 */
export function periodRange(kind: PeriodKind, offset: number, today: string): PeriodRange {
  const n = PERIOD_DAYS[kind];
  // 负数/NaN 一律归零：窗口末端不允许越过今天，否则未来日会被当成「没记录」
  const k = Math.max(0, Math.floor(offset) || 0);
  const to = addDays(today, -k * n);
  const from = addDays(to, -(n - 1));
  const all = dayRange(from, to);
  const label = k === 0
    ? `近 ${n} 天`
    : `${n} 天 · ${shortDate(from)}–${shortDate(to)}`;
  return { kind, from, to, elapsed: all.filter((d) => d <= today), label };
}

/** 上一个窗口：整段前移 N 天，紧邻不重叠（prev.to === addDays(cur.from, -1)） */
export function previousRange(kind: PeriodKind, offset: number, today: string): PeriodRange {
  return periodRange(kind, offset + 1, today);
}

// ── 目标时间线 ───────────────────────────────────────────────

export type GoalResolver = (day: string) => GoalSnapshot;

/**
 * 目标有版本（改了体重/目标会生成新快照），历史记录必须按当时的基准判达标。
 * 用一条时间线一次性解析，避免 90 天查 90 次库。
 */
export function makeGoalResolver(goals: GoalSnapshot[], fallback: GoalSnapshot): GoalResolver {
  const sorted = [...goals].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  return (day) => {
    let hit: GoalSnapshot | null = null;
    for (const g of sorted) {
      if (g.effectiveFrom <= day) hit = g;
      else break;
    }
    return hit ?? sorted[0] ?? fallback;
  };
}

// ── 单日聚合 ─────────────────────────────────────────────────

export interface DayStat {
  day: string;
  meals: number;
  recorded: boolean;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  goalKcal: number;
  goalProteinG: number;
  /** 有可靠数据的微量；null 表示当天无可用数据 */
  micro: Partial<Record<MicroKey, number>>;
  microCoverage: Partial<Record<MicroKey, number>>;
  /** 该日微量是否达到可信覆盖（≥50%） */
  microReliable: Partial<Record<MicroKey, boolean>>;
}

const num = (v: number | null | undefined): number => (isKnown(v) ? (v as number) : 0);

/** 单日微量覆盖下限：与 calc.ts 的 COVERAGE_MIN 保持一致，低于此值不给数值 */
const MICRO_MIN = 0.5;

function dayStat(day: string, meals: Meal[], goal: GoalSnapshot): DayStat {
  const fact: NutritionFacts = {
    kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0,
    sodium: 0, potassium: 0, calcium: 0, iron: 0, zinc: 0, selenium: 0,
    magnesium: 0, va: 0, vc: 0, vd: 0, ve: 0, b1: 0, b2: 0, niacin: 0,
  };
  const knownGrams = {} as Record<NutrientKey, number>;
  for (const k of Object.keys(fact) as NutrientKey[]) knownGrams[k] = 0;

  let totalGrams = 0;
  let kcalKnown = false;

  for (const m of meals) {
    for (const it of m.items) {
      const g = Math.max(0, it.grams);
      totalGrams += g;
      for (const k of Object.keys(fact) as NutrientKey[]) {
        const v = it.nutrition[k];
        if (!isKnown(v)) continue;
        fact[k] = (fact[k] as number) + (v as number);
        knownGrams[k] += g;
        if (k === 'kcal') kcalKnown = true;
      }
    }
  }

  const micro: Partial<Record<MicroKey, number>> = {};
  const microCoverage: Partial<Record<MicroKey, number>> = {};
  const microReliable: Partial<Record<MicroKey, boolean>> = {};
  for (const k of MICRO_KEYS) {
    const cov = totalGrams > 0 ? knownGrams[k] / totalGrams : 0;
    const ok = cov >= MICRO_MIN && knownGrams[k] > 0;
    microCoverage[k] = cov;
    microReliable[k] = ok;
    if (ok) micro[k] = fact[k] as number;
  }

  return {
    day,
    meals: meals.length,
    recorded: meals.length > 0 && kcalKnown,
    kcal: kcalKnown ? (fact.kcal as number) : 0,
    protein: num(fact.protein),
    fat: num(fact.fat),
    carbs: num(fact.carbs),
    fiber: num(fact.fiber),
    goalKcal: goal.kcal,
    goalProteinG: goal.proteinG,
    micro,
    microCoverage,
    microReliable,
  };
}

// ── 周期汇总 ─────────────────────────────────────────────────

export interface MicroGap {
  key: MicroKey;
  label: string;
  /** 可靠日均 */
  avg: number;
  target: number;
  /** avg / target */
  ratio: number;
  /** 支撑这个结论的可靠天数 */
  days: number;
}

export interface PeriodSummary {
  range: PeriodRange;
  days: DayStat[];
  recordedDays: number;
  elapsedDays: number;
  /** 记录覆盖 0~1 */
  coverage: number;

  avgKcal: number | null;
  avgProtein: number | null;
  /** 平均每日缺口（目标 − 实际），正数=还在缺口里 */
  avgDeficit: number | null;
  /** 累计缺口 = Σ 记录日的（目标 − 实际） */
  totalDeficit: number | null;
  /** 理论体重变化 kg，负数=降。仅由累计缺口推算，不含水分 */
  theoryKg: number | null;

  onTargetDays: number;
  overDays: number;
  proteinHitDays: number;

  microGaps: MicroGap[];

  weekday: { avgKcal: number; days: number } | null;
  weekend: { avgKcal: number; days: number } | null;
}

/** 7700 kcal ≈ 1kg 脂肪。用固定常数而非模型估算，结果可复算 */
export const KCAL_PER_KG_FAT = 7700;

/** 达标带宽：热量在目标 ±10% 内算达标 */
export const ON_TARGET_BAND = 0.1;

/** 微量缺口入榜门槛：日均低于目标 80%，且至少 3 个可靠日 */
const MICRO_GAP_RATIO = 0.8;
const MICRO_GAP_MIN_DAYS = 3;

function isWeekend(day: string): boolean {
  const dow = parseDayKey(day).getDay();
  return dow === 0 || dow === 6;
}

export function summarise(
  range: PeriodRange,
  meals: Meal[],
  goalOf: GoalResolver,
): PeriodSummary {
  const byDay = new Map<string, Meal[]>();
  for (const m of meals) {
    const list = byDay.get(m.date);
    if (list) list.push(m);
    else byDay.set(m.date, [m]);
  }

  const days = range.elapsed.map((d) => dayStat(d, byDay.get(d) ?? [], goalOf(d)));
  const recorded = days.filter((d) => d.recorded);

  const avgKcal = recorded.length > 0
    ? recorded.reduce((a, d) => a + d.kcal, 0) / recorded.length
    : null;
  const avgProtein = recorded.length > 0
    ? recorded.reduce((a, d) => a + d.protein, 0) / recorded.length
    : null;

  const deficits = recorded.map((d) => d.goalKcal - d.kcal);
  const totalDeficit = deficits.length > 0 ? deficits.reduce((a, b) => a + b, 0) : null;
  const avgDeficit = totalDeficit != null ? totalDeficit / recorded.length : null;

  const onTargetDays = recorded.filter(
    (d) => Math.abs(d.kcal - d.goalKcal) <= d.goalKcal * ON_TARGET_BAND,
  ).length;
  const overDays = recorded.filter((d) => d.kcal > d.goalKcal * (1 + ON_TARGET_BAND)).length;
  const proteinHitDays = recorded.filter((d) => d.protein >= d.goalProteinG).length;

  // 微量缺口：只统计「该日该项可信」的天数
  const targetMicro = goalOf(range.elapsed[range.elapsed.length - 1] ?? range.to).micro;
  const microGaps: MicroGap[] = [];
  for (const key of MICRO_KEYS) {
    const target = targetMicro[key];
    if (!isKnown(target) || (target as number) <= 0) continue;
    const vals = recorded
      .filter((d) => d.microReliable[key] && isKnown(d.micro[key]))
      .map((d) => d.micro[key] as number);
    if (vals.length < MICRO_GAP_MIN_DAYS) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const ratio = avg / (target as number);
    if (ratio < MICRO_GAP_RATIO) {
      microGaps.push({ key, label: NUTRIENT_LABELS[key], avg, target: target as number, ratio, days: vals.length });
    }
  }
  microGaps.sort((a, b) => a.ratio - b.ratio);

  // 周末 vs 工作日：只在窗口足够长（月/季）时给。
  // 7 天窗口里只有 2 个周末日，拿它外推「每月 8 个周末日」纯属噪声 —— 窗口必须 ≥14 天才给。
  let weekday: PeriodSummary['weekday'] = null;
  let weekend: PeriodSummary['weekend'] = null;
  if (range.elapsed.length >= 14 && recorded.length >= 7) {
    const wk = recorded.filter((d) => !isWeekend(d.day));
    const we = recorded.filter((d) => isWeekend(d.day));
    if (wk.length >= 3) {
      weekday = { avgKcal: wk.reduce((a, d) => a + d.kcal, 0) / wk.length, days: wk.length };
    }
    if (we.length >= 2) {
      weekend = { avgKcal: we.reduce((a, d) => a + d.kcal, 0) / we.length, days: we.length };
    }
  }

  return {
    range,
    days,
    recordedDays: recorded.length,
    elapsedDays: range.elapsed.length,
    coverage: range.elapsed.length > 0 ? recorded.length / range.elapsed.length : 0,
    avgKcal,
    avgProtein,
    avgDeficit,
    totalDeficit,
    /**
     * 缺口为正（吃得比目标少）→ 体重应当**下降**，所以取负号。
     * 这个符号写反过一次：界面显示「理论 +0.2kg」而实际 −0.4kg，
     * 判定却算成「掉得太多」——数字看着都合理，只有对着算一遍才发现。
     */
    theoryKg: totalDeficit != null ? -totalDeficit / KCAL_PER_KG_FAT : null,
    onTargetDays,
    overDays,
    proteinHitDays,
    microGaps: microGaps.slice(0, 3),
    weekday,
    weekend,
  };
}

// ── 体重：7 日移动平均 ───────────────────────────────────────

export interface WeightPoint {
  day: string;
  raw: number | null;
  /** 7 日移动平均（含当天在内的最近 7 天里所有称重） */
  ma: number | null;
}

/**
 * 原始日体重受水分、盐分、排便影响，日间波动 ±1kg 是常态。
 * 直接画原始点用户看到锯齿会以为方案失效，所以画 7 日移动平均。
 */
export function smoothWeights(entries: WeightEntry[], windowDays = 7): WeightPoint[] {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((e) => {
    const from = addDays(e.date, -(windowDays - 1));
    const win = sorted.filter((x) => x.date >= from && x.date <= e.date);
    const ma = win.length > 0
      ? win.reduce((a, x) => a + x.weightKg, 0) / win.length
      : null;
    return { day: e.date, raw: e.weightKg, ma };
  });
}

export interface WeightChange {
  from: number;
  to: number;
  /** 正数=增重 */
  deltaKg: number;
  /** 起止各由几个点支撑 */
  points: number;
  method: 'ma' | 'raw';
}

/**
 * 周期内的实际体重变化。
 * 有 ≥3 个称重点时用移动平均的起止值（抗水分波动），否则退回原始首末值并标注。
 */
export function weightChange(entries: WeightEntry[], from: string, to: string): WeightChange | null {
  const inRange = entries
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (inRange.length < 2) return null;

  const smoothed = smoothWeights(inRange);
  if (inRange.length >= 3) {
    const a = smoothed[0]?.ma;
    const b = smoothed[smoothed.length - 1]?.ma;
    if (a != null && b != null) {
      return { from: a, to: b, deltaKg: b - a, points: inRange.length, method: 'ma' };
    }
  }
  const a = inRange[0]!.weightKg;
  const b = inRange[inRange.length - 1]!.weightKg;
  return { from: a, to: b, deltaKg: b - a, points: inRange.length, method: 'raw' };
}
