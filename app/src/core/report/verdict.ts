/**
 * 「理论 vs 实际」判定引擎。
 *
 * 这是整个产品最有价值也最容易骗人的一个功能：
 * 累计缺口 / 7700 能算出理论掉多少公斤，称重能算出实际掉了多少，两者一比就知道
 * **到底是记录不准，还是身体没按预期走**。绝大多数 App 只报体重，不解释差在哪。
 *
 * 所以这里宁可多说「数据不够，先别下结论」，也不给一个看起来专业但站不住的结论。
 */

import type { GoalType } from '../db/types';
import { KCAL_PER_KG_FAT } from './period';

export type VerdictKind =
  | 'lowCoverage'   // 记录天数不够，不下结论
  | 'noWeight'      // 没有称重，只能给理论值
  | 'dataSuspect'   // 理论值本身就离谱，先怀疑记录
  | 'onTrack'       // 理论与实际吻合
  | 'estimateLow'   // 实际没掉那么多 -> 摄入被低估 / 活动量被高估
  | 'dropTooFast';  // 掉得比理论快 -> 掉肌肉或脱水风险

export type VerdictTone = 'good' | 'warn' | 'bad' | 'muted';

export interface VerdictInput {
  theoryKg: number | null;
  actualKg: number | null;
  /** 记录覆盖 0~1 */
  coverage: number;
  elapsedDays: number;
  goalType: GoalType;
  /** 蛋白达标天数 / 记录天数，用于「掉太快」时的建议 */
  proteinHitRate?: number;
}

export interface Verdict {
  kind: VerdictKind;
  tone: VerdictTone;
  headline: string;
  body: string;
  /** 折算成「每天差多少 kcal」，能具体到数字就不说「可能」 */
  impliedKcalPerDay: number | null;
}

/** 记录覆盖低于此值，一切体重结论都不成立：漏记的日子会被当成「没吃」 */
export const MIN_COVERAGE = 0.6;

/** 理论与实际差异小于此值即视为吻合（单周的水分波动量级） */
export const TOLERANCE_KG = 0.3;

/**
 * 容差随周期拉长而放大，但封顶。
 *
 * 一周差 0.5kg 值得追问；一个月差 0.5kg 说明不了任何事 ——
 * 记录误差（份量估算 ±10%）、水分、糖原都会累积，且不会互相抵消。
 * 固定用 0.3kg 会让月报频繁喊「你掉肌肉了」，而那种警报多了就没人信了。
 *
 * 封顶 1.2kg（约体重的 1.5%）是为了避免长周期把容差撑到「什么都判不出来」，
 * 一周掉超过体重 1% 这类真问题必须还能被抓住。
 */
export const MAX_TOLERANCE_KG = 1.2;

export function toleranceKg(elapsedDays: number): number {
  return Math.min(MAX_TOLERANCE_KG, Math.max(TOLERANCE_KG, 0.35 + 0.02 * elapsedDays));
}

/** 每周理论变化超过此值，先怀疑记录而不是庆祝 */
export const SUSPECT_KG_PER_WEEK = 1.5;

function r1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** 带符号的 kg 展示；绝对值小于 0.05 时不要输出「−0.0」这种看着像错的东西 */
function signedKg(v: number): string {
  if (Math.abs(v) < 0.05) return '0.0';
  return `${v < 0 ? '−' : '+'}${r1(Math.abs(v))}`;
}

export function judge(input: VerdictInput): Verdict {
  const { theoryKg, actualKg, coverage, elapsedDays, goalType, proteinHitRate } = input;
  const weeks = Math.max(elapsedDays / 7, 1);

  if (coverage < MIN_COVERAGE || theoryKg == null) {
    const pct = Math.round(coverage * 100);
    return {
      kind: 'lowCoverage',
      tone: 'muted',
      headline: '记录太少，先不下结论',
      body: `这段时间只有 ${pct}% 的日子有记录。漏记的日子会被当成「没吃」，理论缺口会虚高，`
        + `这时候算出来的「应该掉多少」一定是错的。补几天记录再看。`,
      impliedKcalPerDay: null,
    };
  }

  if (Math.abs(theoryKg / weeks) > SUSPECT_KG_PER_WEEK) {
    return {
      kind: 'dataSuspect',
      tone: 'warn',
      headline: '这个缺口大得不正常',
      body: `按记录推算每周要掉 ${r1(Math.abs(theoryKg / weeks))}kg，超过安全速度。`
        + `更可能是有几天只记了一部分（比如漏了早餐或零食），而不是真的吃这么少。`
        + `先把记录补全，否则后面的判断全被这个虚高缺口带偏。`,
      impliedKcalPerDay: null,
    };
  }

  if (actualKg == null) {
    return {
      kind: 'noWeight',
      tone: 'muted',
      headline: '只算出了理论值',
      body: `按累计缺口推算，这段时间理论上变化 ${signedKg(theoryKg)}kg。`
        + `但没有两次以上称重，无法对照。每周固定一天早晨称一次（空腹、排空后），`
        + `一周后就能看出记录准不准。`,
      impliedKcalPerDay: null,
    };
  }

  const diff = actualKg - theoryKg;
  const tol = toleranceKg(elapsedDays);

  if (Math.abs(diff) < tol) {
    return {
      kind: 'onTrack',
      tone: 'good',
      headline: '记录和身体对得上',
      body: `理论 ${signedKg(theoryKg)}kg，实际 ${signedKg(actualKg)}kg，`
        + `差 ${r1(Math.abs(diff))}kg，在这个周期的容差（±${r1(tol)}kg）内。`
        + `说明份量估得准，按现在的节奏继续就行。`,
      impliedKcalPerDay: null,
    };
  }

  const implied = Math.round((diff * KCAL_PER_KG_FAT) / Math.max(elapsedDays, 1));

  if (diff > 0) {
    // 实际比理论重 -> 吃得比记录的多，或动得比设定的少
    const bg = goalType === 'lose'
      ? `按记录你每天缺口应该有 ${Math.abs(Math.round(theoryKg * KCAL_PER_KG_FAT / Math.max(elapsedDays, 1)))}kcal，`
        + `但身体没按这个速度走，相当于每天多吃进了约 ${Math.abs(implied)}kcal。`
      : `身体的变化和记录不符，折算下来每天约有 ${Math.abs(implied)}kcal 没被记进去。`;
    return {
      kind: 'estimateLow',
      tone: 'warn',
      headline: `实际比理论重 ${r1(diff)}kg`,
      body: `${bg}最常见的来源是烹调油（一勺就是 90kcal 且看不见）、`
        + `零食饮料没记、以及外卖份量比自制大。下一周重点核对这三处，不用改饮食结构。`
        + `也可能只是水分与糖原波动，再看一周才作数。`,
      impliedKcalPerDay: implied,
    };
  }

  const lowProtein = (proteinHitRate ?? 1) < 0.6;
  return {
    kind: 'dropTooFast',
    tone: lowProtein ? 'bad' : 'warn',
    headline: `比理论多掉了 ${r1(Math.abs(diff))}kg`,
    body: `理论 ${signedKg(theoryKg)}kg，实际掉了 ${r1(Math.abs(actualKg))}kg。`
      + `偏快的时候掉的往往不只是脂肪——水分、糖原、甚至肌肉都会一起走。`
      + (lowProtein
        ? `而且蛋白达标率只有 ${Math.round((proteinHitRate ?? 0) * 100)}%，这是掉肌肉最直接的原因。先把蛋白补到目标，再谈速度。`
        : `先确认蛋白每天吃到目标，再考虑是不是活动量比设定的大。`)
      + `一周掉超过体重 1% 就不该继续加速。`,
    impliedKcalPerDay: implied,
  };
}
