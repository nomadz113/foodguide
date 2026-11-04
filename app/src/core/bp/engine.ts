/**
 * 血压引擎 —— 全项目所有血压数字的出处。
 *
 * 唯一的纪律：**分级、统计、紧迫度全部由这里的函数算，模型只负责把屏幕上的数字读出来。**
 *
 * 区别在于：模型的输出没有回归测试，而且它说错话的时候不自知。把诊断性判断交给它，
 * 等于把「要不要就医」这类问题上的兜底环节外包出去。这里每条规则都能被单测钉住。
 */

import type { BpCategory, BpEntry } from '../db/types';
import { addDays } from '../date';

export interface BpReading {
  systolic: number;
  diastolic: number;
}

/** 中国高血压防治指南的默认达标线。用户可以在设置里改成 130/80（糖尿病/肾病常见） */
export const BP_TARGET_DEFAULT: BpTarget = { systolic: 140, diastolic: 90 };

export interface BpTarget {
  systolic: number;
  diastolic: number;
}

/** 0 级=未达高血压门槛（正常或正常高值） */
export type BpGrade = 0 | 1 | 2 | 3;

/**
 * 分级：**两侧取更严重的一侧**。
 * 132/105 会被判为 2 级而不是 1 级 —— 只看收缩压的话，舒张压已经到 2 级这件事就被吃掉了。
 */
export function gradeOf(r: BpReading): BpGrade {
  if (r.systolic >= 180 || r.diastolic >= 110) return 3;
  if (r.systolic >= 160 || r.diastolic >= 100) return 2;
  if (r.systolic >= 140 || r.diastolic >= 90) return 1;
  return 0;
}

/**
 * 展示用的分类。
 *
 * 关于「单纯收缩期高血压」的一个取舍：只有 1 级区间（140≤收缩压<160 且 舒张压<90）
 * 才单独归类。若收缩压已经 ≥160 而舒张压正常，宁可显示 2 级/3 级 ——
 * 这时候用户该在意的是「很高」，不是「这是哪个亚型」。分类学让位给紧迫度。
 */
export function classify(r: BpReading): BpCategory {
  // 偏低先判：85/55 不是「正常」，用户会想知道为什么站起来头晕
  if (r.systolic < 90 || r.diastolic < 60) return 'low';

  const g = gradeOf(r);
  if (g === 0) return r.systolic >= 120 || r.diastolic >= 80 ? 'highNormal' : 'normal';
  if (g === 3) return 'grade3';
  if (g === 2) return 'grade2';
  return r.diastolic < 90 ? 'isolatedSystolic' : 'grade1';
}

export const BP_LABEL: Record<BpCategory, string> = {
  low: '偏低',
  normal: '正常',
  highNormal: '正常高值',
  grade1: '1 级 偏高',
  grade2: '2 级 高',
  grade3: '3 级 很高',
  isolatedSystolic: '单纯收缩期',
};

/** 配色档位。不看分类而看「用户该有多在意」，避免每加一个亚型就要改一遍 UI */
export type BpTone = 'low' | 'ok' | 'warn' | 'high' | 'severe';

export function toneOf(r: BpReading): BpTone {
  const c = classify(r);
  switch (c) {
    case 'low': return 'low';
    case 'normal': return 'ok';
    case 'highNormal': return 'warn';
    case 'grade1':
    case 'isolatedSystolic': return 'high';
    default: return 'severe';
  }
}

/** 脉压差。>60mmHg 在老年人身上提示动脉硬化，出现时要提醒复诊而不是提醒运动 */
export function pulsePressure(r: BpReading): number {
  return r.systolic - r.diastolic;
}

export function isOnTarget(r: BpReading, target: BpTarget = BP_TARGET_DEFAULT): boolean {
  return r.systolic < target.systolic && r.diastolic < target.diastolic;
}

/** 平均读数。空数组返回 null —— 空集的平均不存在，返回 0 会渲染成「0/0」 */
export function meanReading(list: BpReading[]): BpReading | null {
  if (list.length === 0) return null;
  let s = 0;
  let d = 0;
  for (const r of list) {
    s += r.systolic;
    d += r.diastolic;
  }
  return {
    systolic: Math.round(s / list.length),
    diastolic: Math.round(d / list.length),
  };
}

// ── 排序 ───────────────────────────────────────────────────
/**
 * 两条记录的先后顺序：**先比测量时刻，同一时刻再比写入时刻**（升序语义）。
 *
 * 第二级排序不是洁癖。录入控件是 `datetime-local`，只有分钟精度 ——
 * 同一分钟里连记两条，measuredAt 会**完全相同**，排序到此为止就只能由主键
 * （随机 nanoid）分胜负：用户会遇到「我刚记的那条不见了」，而且复现不了。
 * 退到写入时刻兜底之后，答案至少是「最近写的那条」，和用户预期一致。
 */
export function compareBp(
  a: { measuredAt: number; createdAt: number },
  b: { measuredAt: number; createdAt: number },
): number {
  if (a.measuredAt !== b.measuredAt) return a.measuredAt - b.measuredAt;
  return a.createdAt - b.createdAt;
}

// ── 时段划分 ───────────────────────────────────────────────
/**
 * 晨峰 6:00–09:59、晚峰 18:00–21:59。
 *
 * 这两个窗口是血压最有信息量的时段：晨峰心血管事件高发，晚间读数反映全天负荷。
 * 之所以限制范围而不是取「上午/下午」，是因为上午 11 点的读数和 6 点半的读数
 * 混在一起平均，只会得到一条没有意义的中间值。
 */
export const MORNING: [number, number] = [6, 10];
export const EVENING: [number, number] = [18, 22];

export type BpWindow = 'morning' | 'evening' | 'other';

export function hourOf(measuredAt: number): number {
  return new Date(measuredAt).getHours();
}

export function windowOf(measuredAt: number): BpWindow {
  const h = hourOf(measuredAt);
  if (h >= MORNING[0] && h < MORNING[1]) return 'morning';
  if (h >= EVENING[0] && h < EVENING[1]) return 'evening';
  return 'other';
}

// ── 周期汇总 ───────────────────────────────────────────────
export interface BpSummary {
  /** 有记录的天数。所有比率的分母都是它，不是窗口总天数 —— 见备注 */
  recordedDays: number;
  /** 每天一条（当天均值），按日期升序 */
  days: { date: string; reading: BpReading; entries: number }[];
  mean: BpReading | null;
  morningMean: BpReading | null;
  eveningMean: BpReading | null;
  /** 晨/晚各由几条记录支撑。没有它，用户无法判断「晨比晚低 6」是规律还是巧合 */
  morningCount: number;
  eveningCount: number;
  /** 样本够不够支撑「晨 vs 晚」的结论 */
  windowComparable: boolean;
  highest: BpEntry | null;
  lowest: BpEntry | null;
  /** 达标天数（当天均值在目标内） */
  onTargetDays: number;
  /** 后半窗口均值 − 前半窗口均值；样本不足为 null */
  trend: BpReading | null;
}

/** 出「晨/晚对比」结论的最低样本数。低于这个数，两者的差基本是噪声 */
export const WINDOW_COMPARE_MIN = 3;
/** 出「趋势」结论的最低记录数 */
export const TREND_MIN = 6;

/**
 * 汇总一个周期。
 *
 * 分母用「有记录的天」而不是窗口总天数 —— 和 report/summarise 同一条铁律：
 * 记录三天就按三天算比率，不要用「7 天里只有 1 天达标」去吓唬用户。
 * 一天多次测量先合成当天均值再做判定，否则测得多的人天然「达标率」更低。
 */
export function summariseBp(
  entries: BpEntry[],
  target: BpTarget = BP_TARGET_DEFAULT,
): BpSummary {
  const live = entries.filter((e) => e.deletedAt == null);
  const byDate = new Map<string, BpEntry[]>();
  for (const e of live) {
    const arr = byDate.get(e.date);
    if (arr) arr.push(e);
    else byDate.set(e.date, [e]);
  }

  const dates = [...byDate.keys()].sort();
  const days = dates.map((date) => {
    const rows = byDate.get(date)!;
    return { date, reading: meanReading(rows)!, entries: rows.length };
  });

  const morning = live.filter((e) => windowOf(e.measuredAt) === 'morning');
  const evening = live.filter((e) => windowOf(e.measuredAt) === 'evening');

  let highest: BpEntry | null = null;
  let lowest: BpEntry | null = null;
  for (const e of live) {
    if (!highest || e.systolic > highest.systolic) highest = e;
    if (!lowest || e.systolic < lowest.systolic) lowest = e;
  }

  const onTargetDays = days.filter((d) => isOnTarget(d.reading, target)).length;

  let trend: BpReading | null = null;
  if (live.length >= TREND_MIN) {
    const half = Math.floor(live.length / 2);
    const first = meanReading(live.slice(0, half));
    const last = meanReading(live.slice(half));
    if (first && last) {
      trend = {
        systolic: Math.round(last.systolic - first.systolic),
        diastolic: Math.round(last.diastolic - first.diastolic),
      };
    }
  }

  return {
    recordedDays: days.length,
    days,
    mean: meanReading(live),
    morningMean: meanReading(morning),
    eveningMean: meanReading(evening),
    morningCount: morning.length,
    eveningCount: evening.length,
    windowComparable:
      morning.length >= WINDOW_COMPARE_MIN && evening.length >= WINDOW_COMPARE_MIN,
    highest,
    lowest,
    onTargetDays,
    trend,
  };
}

/**
 * 连续记录天数（截至今天，从今天或昨天算起）。
 * 断一天就归零 —— 这是自我记录类功能的常识：连续性本身就是激励，
 * 一周只记两次的用户需要知道的不是「总共记了 30 条」，而是「这周断了」。
 */
export function streakDays(dates: string[], today: string): number {
  const set = new Set(dates);
  let cursor = set.has(today) ? today : prevDay(today);
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = prevDay(cursor);
  }
  return n;
}

function prevDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── 固定的回看窗口 ───────────────────────────────────────────

/**
 * 首页「晨峰 / 晚峰」的回看长度。
 *
 * 14 天不是随手取的：晨晚各需 3 次才能比较（WINDOW_COMPARE_MIN），7 天窗口里
 * 多数人只有 1–2 次晨测，卡片会长期显示「样本还不够」—— 一张永远不下结论的卡
 * 比没有这张卡更让人困惑。30 天又太长，两周以上的作息变化会把两种节奏混在一起。
 */
export const HOME_BP_DAYS = 14;

/**
 * 以 today 结尾的 N 天窗口（首尾都含）。
 *
 * 抽成纯函数是为了能被单测钉住：`from = today - (N-1)` 这个减一，
 * 写成 `-N` 就会悄悄多算一天，而界面上一行字都不会变 —— 只是窗口长度变成 15。
 */
export function bpWindow(today: string, days: number = HOME_BP_DAYS): { from: string; to: string } {
  const n = Math.max(1, Math.floor(days) || 1);
  return { from: addDays(today, -(n - 1)), to: today };
}
