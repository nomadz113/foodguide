/**
 * 体脂秤读数的硬校验。
 *
 * 和血压 guard.ts 是同一职责，但校验的**理由不同**：
 * 血压读错的代价是用户会当真然后去医院；体重读错的代价是
 * **每天的热量目标从这一刻起全部算歪**，而且没有任何界面会表现出"这里错了"。
 *
 * 两个具体后果：
 * 1. 体重直接进 BMR（Mifflin 的 10w 项，Katch 的 LBM 项），差 10 kg 差 100+ kcal/天；
 * 2. 体脂率一旦非 null，buildGoalSnapshot 会把公式从 Mifflin 整套换成 Katch-McArdle
 *    —— 所以一个编出来的 22% 不只是"多了一个数字"，它换了整条计算链路。
 *
 * 因此这里的区间必须与档案校验（core/goal/engine.ts 的 LIMITS）**共用同一份常量**，
 * 不能另造一套：否则会出现「识别层放行、档案页保存被拦」的自相矛盾，
 * 用户看到的是"填好了却存不进去"，而两边都认为自己是对的。
 *
 * 挡住的方式仍然是**报错给人看**，不是自动修正 —— 自动把 320 改成 80 比不填更糟。
 */

import { LIMITS } from '../goal/engine';
import type { WeightUnit } from '../ai/keepPrompt';

/** 1 lb = 0.45359237 kg（国际磅定义值，不是近似） */
export const KG_PER_LB = 0.45359237;

export type ScaleField = 'weight' | 'bodyFatPct';

export interface RawScaleReading {
  weight: number | null;
  /** 没标注就按 kg —— 但页面标注了 lb 而模型漏读 unit 时，这里会误判，所以 prompt 要求如实上报 */
  unit?: WeightUnit | null;
  bodyFatPct?: number | null;
}

export interface CheckedScaleReading {
  /** 一律 kg，一位小数 */
  weightKg: number;
  /** 一律百分数，一位小数；没测到就是 null，绝不退化成 0 */
  bodyFatPct: number | null;
}

export type CheckScaleOutcome =
  | { ok: true; reading: CheckedScaleReading; converted: boolean }
  | { ok: false; field: ScaleField; reason: string };

/** 保留一位小数。体脂秤的显示精度就是 0.1，多存的位数只是噪声 */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** lb → kg。只在这里做换算，别处一律使用 kg */
export function toKg(value: number, unit: WeightUnit = 'kg'): number {
  return unit === 'lb' ? round1(value * KG_PER_LB) : value;
}

function asNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

/**
 * 校验一次读数。
 *
 * 顺序有讲究：**先换算单位，再查区间**。反过来的话，一台显示 lb 的秤
 * 报出 158.9 会被当成 158.9 kg 而直接放过（在 30~300 之内），
 * 于是用户的实际体重 72.1 kg 变成 158.9 kg，BMR 从 1600 变成 2900。
 * 这与 bp/guard.ts 里"先换算再查区间"是同一个教训。
 */
export function checkScaleReading(raw: RawScaleReading): CheckScaleOutcome {
  const unit = raw.unit ?? 'kg';
  const converted = unit === 'lb';

  const w = asNumber(raw.weight);
  if (w == null) return { ok: false, field: 'weight', reason: '体重没读到，请手动补上' };

  const weightKg = round1(toKg(w, unit));

  if (weightKg < LIMITS.weightKg[0] || weightKg > LIMITS.weightKg[1]) {
    const shown = converted ? `${weightKg} kg（原值 ${w} lb）` : `${weightKg} kg`;
    return { ok: false, field: 'weight', reason: `体重 ${shown} 不在合理范围，请核对截图` };
  }

  const bf = asNumber(raw.bodyFatPct);
  let bodyFatPct: number | null = null;
  if (bf != null) {
    const v = round1(bf);
    if (v < LIMITS.bodyFatPct[0] || v > LIMITS.bodyFatPct[1]) {
      // 0 是最常见的"其实没测到"伪装：有的页面未测量时印 0.0%。
      // 这里不把它当 0 放过，也不擅自改成 null —— 报错让用户决定。
      return { ok: false, field: 'bodyFatPct', reason: `体脂率 ${v}% 不在合理范围，请核对截图` };
    }
    bodyFatPct = v;
  }

  return { ok: true, reading: { weightKg, bodyFatPct }, converted };
}
