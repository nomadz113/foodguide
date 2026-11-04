/**
 * 克数的精度与刻度 —— 一处定义，三处页面共用。
 *
 * 为什么必须留小数：盐、油、糖这类调味料的整份常常只有零点几克。
 * 焯水配菜的盐是 0.3~0.5g，取整成 1g 就是 +150%~233%，一餐两条盐会凭空多出
 * 200~250mg 钠（占全天 2000mg 上限的一成）。AI 其实算对了，是入库前被 round 掉了。
 *
 * 为什么大克数仍然取整：一碗饭 150g 记成 149.7g 是假精确，也不可读。
 * 20g 是个自然分界 —— 小于它的是调味料，大于它的是食材和主食。
 */

/** 小于这个数保留 1 位小数，大于等于它取整 */
const DECIMAL_UNDER = 20;

/** 最小刻度：记 0 克等于没吃，不如让用户删掉这一条 */
const MIN_GRAMS = 0.1;

/**
 * 统一克数精度。
 *
 * 分两段：≥20g 取整，<20g 留 1 位小数。`min` 兜住下限，非法值（NaN/负数）也落到这里。
 *
 * 注意 `min` 是「兜底」不是「夹逼」：0.3g 不会被抬到 0.5g，只有算出来 ≤0 才兜。
 */
export function roundGrams(raw: number, min: number = MIN_GRAMS): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return min;
  const r = v >= DECIMAL_UNDER ? Math.round(v) : Math.round(v * 10) / 10;
  return Math.max(min, r);
}

/** 显示用：避免出现 0.30000000000000004 这种浮点尾巴 */
export function fmtGrams(g: number): string {
  const v = Number(g);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 10) / 10);
}

/**
 * 加减键的步长 —— 跟着当前克数走，不是跟着条目身份走。
 *
 * 调味料 0.4g 时用 3g 步进，按一下就到 3.4g，等于没法调；用 0.5g 才对得上刻度。
 * 中间的 3g 是上一版定下来的（5g 太粗，盐 2g 一按就翻倍），主食仍用 10g：
 * 一碗饭 150g 按 3g 调要按 50 下。
 */
export function gramsStep(g: number): number {
  const v = Number(g);
  if (!Number.isFinite(v) || v <= 0) return 0.5;
  if (v <= 5) return 0.5;
  if (v <= 60) return 3;
  return 10;
}
