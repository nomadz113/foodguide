/**
 * 目标引擎：档案 → 目标快照。
 *
 * 原则：所有数字由公式算出，AI 只负责把它翻译成人话。
 * buildGoalSnapshot 是纯函数（除了取当前时间），可被 vitest 穷举边界。
 */

import { driFor } from '../nutrition/dri';
import type { GoalSnapshot, Profile, ActivityLevel } from '../db/types';

/** TDEE 活动系数 */
export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: '久坐',
  light: '轻度活动',
  moderate: '中度活动',
  active: '高度活动',
  very_active: '极高强度',
};

/** 1kg 脂肪约 7700 kcal */
export const KCAL_PER_KG_FAT = 7700;

export interface Issue {
  code: string;
  level: 'error' | 'warn';
  message: string;
}

// ── 基础度量 ───────────────────────────────────────────────

export function ageYears(birthDate: string, at: Date = new Date()): number {
  const b = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(b.getTime())) return 0;
  let age = at.getFullYear() - b.getFullYear();
  const m = at.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age -= 1;
  return Math.max(0, age);
}

/** Mifflin-St Jeor，人群适用性最好 */
export function bmrMifflin(
  p: Pick<Profile, 'sex' | 'birthDate' | 'heightCm' | 'weightKg'>,
  at: Date = new Date(),
): number {
  const a = ageYears(p.birthDate, at);
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * a;
  return p.sex === 'male' ? base + 5 : base - 161;
}

/** Katch-McArdle，基于瘦体重，健身人群更准 */
export function bmrKatch(bodyFatPct: number, weightKg: number): number {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * lbm;
}

export function tdee(bmr: number, level: ActivityLevel): number {
  return bmr * (ACTIVITY_FACTOR[level] ?? 1.2);
}

export type BmiLevel = 'under' | 'normal' | 'over' | 'obese';

export interface BmiResult {
  value: number;
  level: BmiLevel;
  label: string;
}

/** 中国成人标准，非 WHO 标准 */
export function bmi(weightKg: number, heightCm: number): BmiResult {
  const h = heightCm / 100;
  const value = h > 0 ? weightKg / (h * h) : 0;
  return { value, ...bmiLevel(value) };
}

export function bmiLevel(value: number): { level: BmiLevel; label: string } {
  if (value < 18.5) return { level: 'under', label: '偏瘦' };
  if (value < 24) return { level: 'normal', label: '正常' };
  if (value < 28) return { level: 'over', label: '超重' };
  return { level: 'obese', label: '肥胖' };
}

/** 中心性肥胖：男 ≥90cm、女 ≥85cm */
export function isCentralObesity(waistCm: number | null, sex: Profile['sex']): boolean {
  if (waistCm == null) return false;
  return sex === 'male' ? waistCm >= 90 : waistCm >= 85;
}

// ── 安全校验 ───────────────────────────────────────────────

export const LIMITS = {
  heightCm: [120, 230] as const,
  weightKg: [30, 300] as const,
  bodyFatPct: [3, 60] as const,
  waistCm: [40, 200] as const,
};

export function validateProfile(p: Profile, at: Date = new Date()): Issue[] {
  const issues: Issue[] = [];

  if (p.heightCm < LIMITS.heightCm[0] || p.heightCm > LIMITS.heightCm[1]) {
    issues.push({ code: 'height_range', level: 'error', message: `身高需在 ${LIMITS.heightCm[0]}~${LIMITS.heightCm[1]} cm 之间` });
  }
  if (p.weightKg < LIMITS.weightKg[0] || p.weightKg > LIMITS.weightKg[1]) {
    issues.push({ code: 'weight_range', level: 'error', message: `体重需在 ${LIMITS.weightKg[0]}~${LIMITS.weightKg[1]} kg 之间` });
  }

  const age = ageYears(p.birthDate, at);
  if (age < 16) {
    issues.push({ code: 'age_too_young', level: 'error', message: '本应用面向成年人，16 岁以下请咨询专业人士' });
  }

  const cur = bmi(p.weightKg, p.heightCm);

  if (p.goalType === 'lose') {
    if (cur.level === 'under') {
      issues.push({ code: 'lose_while_underweight', level: 'error', message: `你的 BMI 为 ${cur.value.toFixed(1)}（偏瘦），不建议减脂` });
    }
    if (p.specialStates.includes('pregnant') || p.specialStates.includes('lactating')) {
      issues.push({ code: 'lose_while_pregnant', level: 'error', message: '孕期与哺乳期不建议设定减脂目标' });
    }
    if (p.targetWeightKg == null) {
      issues.push({ code: 'target_required', level: 'error', message: '请填写目标体重' });
    } else {
      const tw = bmi(p.targetWeightKg, p.heightCm);
      if (tw.level === 'under') {
        issues.push({ code: 'target_too_low', level: 'error', message: `目标体重对应 BMI ${tw.value.toFixed(1)}，低于 18.5，请调高目标` });
      }
      if (p.targetWeightKg >= p.weightKg) {
        issues.push({ code: 'target_not_lower', level: 'error', message: '减脂的目标体重应低于当前体重' });
      }
    }
    if (p.paceKgPerWeek == null || p.paceKgPerWeek <= 0) {
      issues.push({ code: 'pace_required', level: 'error', message: '请选择每周期望减重速度' });
    } else if (p.paceKgPerWeek > p.weightKg * 0.01) {
      issues.push({
        code: 'pace_too_fast',
        level: 'warn',
        message: `每周减重超过体重的 1%（${(p.weightKg * 0.01).toFixed(2)} kg）容易掉肌肉并反弹`,
      });
    }
  }

  if (p.goalType === 'gain' && p.targetWeightKg != null && p.targetWeightKg <= p.weightKg) {
    issues.push({ code: 'gain_target_not_higher', level: 'error', message: '增肌的目标体重应高于当前体重' });
  }

  if (p.conditions.length > 0) {
    issues.push({
      code: 'chronic_condition',
      level: 'warn',
      message: '你有慢性病记录，营养素配比未做专门调整，请遵医嘱',
    });
  }

  return issues;
}

// ── 档案指纹 ───────────────────────────────────────────────

/** 只纳入影响计算结果的字段，用于判断是否需要重算目标 */
export function profileHash(p: Profile): string {
  const keys: (keyof Profile)[] = [
    'sex', 'birthDate', 'heightCm', 'weightKg', 'bodyFatPct',
    'activityLevel', 'exerciseTypes', 'exerciseDaysPerWeek',
    'goalType', 'targetWeightKg', 'paceKgPerWeek', 'specialStates',
  ];
  const raw = keys.map((k) => {
    const v = p[k];
    return `${k}=${Array.isArray(v) ? [...v].sort().join(',') : String(v)}`;
  }).join('|');

  // djb2
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── 目标快照 ───────────────────────────────────────────────

export interface BuildOptions {
  /** 生效日 YYYY-MM-DD */
  from: string;
  /** 注入时间便于测试 */
  at?: Date;
  /** 注入 id 生成器便于测试 */
  makeId?: () => string;
}

export function buildGoalSnapshot(p: Profile, opts: BuildOptions): GoalSnapshot {
  const at = opts.at ?? new Date();
  const makeId = opts.makeId ?? (() => `goal_${opts.from}_${profileHash(p)}`);
  // warnings 只装「计算过程产生的」提示（如触底上调）；
  // 表单校验问题由 validateProfile 单独提供，避免两处重复展示。
  const warnings: string[] = [];

  const bmr = p.bodyFatPct != null
    ? bmrKatch(p.bodyFatPct, p.weightKg)
    : bmrMifflin(p, at);
  const total = tdee(bmr, p.activityLevel);

  // ① 目标热量
  let kcalRaw = total;
  if (p.goalType === 'lose') {
    const pace = p.paceKgPerWeek ?? 0.5;
    kcalRaw = total - (pace * KCAL_PER_KG_FAT) / 7;
  } else if (p.goalType === 'gain') {
    kcalRaw = total + 250;
  }

  // ② 安全下限硬拦截
  const floor = Math.max(bmr * 1.1, p.sex === 'male' ? 1500 : 1200);
  if (kcalRaw < floor) {
    kcalRaw = floor;
    warnings.push(
      `按目标速度算出的热量过低（低于安全下限 ${Math.round(floor)} kcal），已上调，实际速度会慢于预期`,
    );
  }

  const kcal = Math.round(kcalRaw);
  const dailyDeficit = total - kcal; // 负数表示盈余

  // ③ 三大宏量
  const losing = p.goalType === 'lose';
  const proteinBase = losing && p.targetWeightKg != null
    ? (p.weightKg + p.targetWeightKg) / 2
    : p.weightKg;

  const hasStrength = p.exerciseTypes.includes('strength');
  const proteinCoef = losing
    ? (hasStrength ? 2.0 : 1.8)
    : p.goalType === 'gain' ? 1.8
      : p.goalType === 'maintain' ? 1.3 : 1.2;

  const proteinG = Math.round(proteinCoef * proteinBase);
  const fatG = Math.round(Math.max(0.8 * proteinBase, (kcal * 0.2) / 9));
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));

  // ④ 纤维 / 钠 / 水
  const dri = driFor({ sex: p.sex, ageYears: ageYears(p.birthDate, at), states: p.specialStates });
  const fiberG = losing ? 30 : dri.fiber;

  // ⑤ 预计周期
  let projectedDays: number | null = null;
  if (losing && p.targetWeightKg != null && dailyDeficit > 0) {
    projectedDays = Math.round(((p.weightKg - p.targetWeightKg) * KCAL_PER_KG_FAT) / dailyDeficit);
  } else if (p.goalType === 'gain' && p.targetWeightKg != null && dailyDeficit < 0) {
    projectedDays = Math.round(((p.targetWeightKg - p.weightKg) * KCAL_PER_KG_FAT) / -dailyDeficit);
  }

  return {
    id: makeId(),
    effectiveFrom: opts.from,
    sourceProfileHash: profileHash(p),
    goalType: p.goalType,
    startWeightKg: p.weightKg,
    targetWeightKg: p.targetWeightKg,
    paceKgPerWeek: p.paceKgPerWeek,
    bmr: Math.round(bmr),
    tdee: Math.round(total),
    kcalFloor: Math.round(floor),
    kcal,
    dailyDeficit: Math.round(dailyDeficit),
    proteinG,
    fatG,
    carbsG,
    fiberG,
    sodiumLimitMg: dri.sodiumLimit,
    waterMl: p.sex === 'male' ? 1700 : 1500,
    micro: { ...dri.micro },
    projectedDays,
    warnings,
    createdAt: at.getTime(),
  };
}

export function projectedWeeks(days: number | null): number | null {
  return days == null ? null : Math.round(days / 7);
}
