/**
 * 血压分类 → 颜色的唯一映射。
 *
 * 放这里而不是散在页面里的理由：同一个 tone 在今日卡、趋势图、列表必须同色，
 * 否则用户会以为「卡片的红色」和「列表的橙红」代表两件事。
 *
 * 值是 CSS 变量名而不是色值 —— 深色/浅色两版的每个色都单独调过对比度，
 * 页面层不能知道具体颜色。
 */

import type { BpTone } from '../core/bp/engine';

export const TONE_VAR: Record<BpTone, string> = {
  low: 'var(--blue)',
  ok: 'var(--green)',
  warn: 'var(--amber)',
  high: 'var(--red)',
  severe: 'var(--red)',
};

/** 3 级才加感叹号：颜色+符号双通道，色弱用户也能分辨「这个要紧」 */
export function toneIcon(tone: BpTone): string {
  return tone === 'severe' ? '⚠ ' : '';
}
