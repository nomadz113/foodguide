/**
 * 「我吃了多少」—— 合餐折算的唯一旋钮。
 *
 * 为什么必须由用户给、由代码乘：
 * 照片里没有任何信息能说明「几个人吃、我夹走几成」。同样一锅 600g 青菜 + 8 块红烧肉，
 * 2 人吃是每人 300g / 4 块，4 人吃是 150g / 2 块，两个假设在像素上完全等价。
 * 让模型心里乘一个比例，代码既拿不到、也无法验证 —— 违反「数字由公式算」这条铁律。
 *
 * 所以口径统一为：
 * 1. AI 一律记录**照片里那一份的整量**（锅里多少就记多少），不做任何折算；
 * 2. `share` 只表达「你吃了其中的几成」，由本模块折算；
 * 3. 三档而不是「几个人」—— 用户确知自己吃了多少，却未必说得清几个人均分。
 */

import { roundGrams } from './grams';

export const SHARE_FACTORS = { all: 1, half: 0.5, third: 0.34 } as const;
export type ShareTier = keyof typeof SHARE_FACTORS;

export const SHARE_LABELS: Record<ShareTier, string> = {
  all: '全部',
  half: '一半',
  third: '三分之一',
};

export const SHARE_ORDER: readonly ShareTier[] = ['all', 'half', 'third'];

export function shareFactor(t: ShareTier | null | undefined): number {
  return t ? SHARE_FACTORS[t] : 1;
}

/**
 * 模型给的 0~1 比例 → 最近的一档。
 * 0.8 以上当「全部」（差 0.2 以内不值得多记一个折算）、0.15 以下当「没给」：
 * 比例太小意味着几乎没吃，那种情况应该直接删条目，而不是记 12g。
 */
export function nearestShareTier(v: unknown): ShareTier | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0.15 || n >= 0.85) return null;
  let best: ShareTier = 'half';
  let diff = Infinity;
  for (const t of SHARE_ORDER) {
    const d = Math.abs(SHARE_FACTORS[t] - n);
    if (d < diff) {
      diff = d;
      best = t;
    }
  }
  return best;
}

/**
 * 整份 → 吃到的那份。
 *
 * 精度交给 `roundGrams`：油盐这类小克数留 1 位小数（0.7g 有意义），
 * 主食/菜这类大克数取整 —— 屏幕上出现「206.9g」既不可读，也是假精确。
 * 下限 0.1g：记 0 克等于没吃，不如让用户删掉这一条。
 * 这里**不能**用 0.5g 下限 —— 0.3g 的盐折三分之一只剩 0.1g，抬到 0.5 等于凭空放大 5 倍。
 */
export function eatenGrams(whole: number, factor: number): number {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const raw = Math.max(0, Number(whole) || 0) * f;
  return roundGrams(raw);
}

/** 反解：想让「吃到」等于 target，整份该是多少（手动加减按吃到的那份走） */
export function wholeFromEaten(target: number, factor: number): number {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return Math.max(0.1, (Number(target) || 0) / f);
}

/** 折算说明，给卡片用；全部时返回 null（没什么好说的） */
export function shareNote(t: ShareTier | null | undefined): string | null {
  if (!t || t === 'all') return null;
  return `整份的 ${SHARE_LABELS[t]}`;
}

const KEY = 'mealShareDefault';

/** 上次选的档位 —— 一家人的吃饭习惯是稳定的，不该每次重新点 */
export function loadShareDefault(): ShareTier {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    if (v === 'all' || v === 'half' || v === 'third') return v;
  } catch {
    /* 隐私模式 / 无痕：读不到就用默认 */
  }
  return 'all';
}

export function saveShareDefault(t: ShareTier): void {
  try {
    globalThis.localStorage?.setItem(KEY, t);
  } catch {
    /* 存不下不影响这一次记账 */
  }
}
