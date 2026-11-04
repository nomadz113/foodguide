/**
 * 读数硬校验。
 *
 * 存在的理由只有一个：**血压数字读错的代价远高于别的识别错误。**
 * 食物份量差 30 克，用户第二天照样吃饭；收缩压和舒张压读反了，
 * 132/85 会变成 85/132 —— 用户会当真，然后去医院。
 *
 * 所以这里只做两件事：单位换算（数字由代码算，不让模型心算），
 * 以及把「不可能的数值」挡在入库之前。挡住的方式是**报错给人看**，不是自动修正。
 */

export type PressureUnit = 'mmHg' | 'kPa';

/** 1 kPa = 7.50061683 mmHg。用精度足够的系数，避免两次换算后再舍入的累积误差 */
export const MMHG_PER_KPA = 7.50061683;

/** 可接受的数值区间。边界比生理极值宽，因为廉价电子血压计本身会跳数 */
export const LIMITS = {
  systolic: [60, 260],
  diastolic: [30, 160],
  /**
   * 收缩压与舒张压之差。
   *
   * 下限 10 是硬道理（更窄不可能），上限却**刻意放宽到 140**：
   * 老年人常见的 170/70、190/70 脉压差本来就有 100~120，那是真实的读数，
   * 卡在第 100 位会把这类用户直接挡在门外。上限只负责挡离谱的组合（260/30）。
   */
  gap: [10, 140],
  pulse: [20, 220],
} as const;

export interface RawReading {
  systolic: number | null;
  diastolic: number | null;
  pulse?: number | null;
  unit?: PressureUnit | null;
}

export interface CheckedReading {
  systolic: number;
  diastolic: number;
  pulse: number | null;
}

export type CheckField = 'systolic' | 'diastolic' | 'pulse' | 'gap';

export type CheckOutcome =
  | { ok: true; reading: CheckedReading; converted: boolean }
  | { ok: false; field: CheckField; reason: string };

/** kPa → mmHg。只在这里做换算，别处一律使用 mmHg 整数 */
export function toMmHg(value: number, unit: PressureUnit = 'mmHg'): number {
  if (unit === 'mmHg') return value;
  return value * MMHG_PER_KPA;
}

function asNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

/**
 * 校验一次读数。
 *
 * 顺序是有讲究的：先换算单位，再做区间与差值检查。
 * 若先查区间，遇到把 kPa 当 mmHg 传进来的情况（26 → 26）会一路放行，
 * 而那实际是 195 mmHg，正是最危险的一类读数。
 */
export function checkReading(raw: RawReading): CheckOutcome {
  const unit = raw.unit ?? 'mmHg';
  const converted = unit === 'kPa';

  const s = asNumber(raw.systolic);
  const d = asNumber(raw.diastolic);

  if (s == null) return { ok: false, field: 'systolic', reason: '高压没读到，请手动补上' };
  if (d == null) return { ok: false, field: 'diastolic', reason: '低压没读到，请手动补上' };

  const systolic = Math.round(toMmHg(s, unit));
  const diastolic = Math.round(toMmHg(d, unit));

  if (systolic < LIMITS.systolic[0] || systolic > LIMITS.systolic[1]) {
    return { ok: false, field: 'systolic', reason: `高压 ${systolic} 不在合理范围，请核对屏幕` };
  }
  if (diastolic < LIMITS.diastolic[0] || diastolic > LIMITS.diastolic[1]) {
    return { ok: false, field: 'diastolic', reason: `低压 ${diastolic} 不在合理范围，请核对屏幕` };
  }
  if (systolic <= diastolic) {
    return { ok: false, field: 'gap', reason: '高压比低压还低，八成是读反了' };
  }

  const gap = systolic - diastolic;
  if (gap < LIMITS.gap[0] || gap > LIMITS.gap[1]) {
    return { ok: false, field: 'gap', reason: `脉压差 ${gap} 不合理，请核对屏幕` };
  }

  const p = asNumber(raw.pulse);
  let pulse: number | null = null;
  if (p != null) {
    const pi = Math.round(p);
    if (pi < LIMITS.pulse[0] || pi > LIMITS.pulse[1]) {
      return { ok: false, field: 'pulse', reason: `脉搏 ${pi} 不在合理范围，请核对屏幕` };
    }
    pulse = pi;
  }

  return { ok: true, reading: { systolic, diastolic, pulse }, converted };
}
