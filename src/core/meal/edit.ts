/**
 * 编辑「已经记下来的一餐」——纯函数部分。
 *
 * 两条纪律：
 * 1. **改克数必须同步重算营养快照。** MealItem.nutrition 是绝对量，
 *    只改 grams 不改 nutrition，界面上就会出现「300g / 150 kcal」这种自相矛盾的数字。
 * 2. **切档位以 baseG 为锚，不从当前 grams 累乘。** 累乘会让「小→中→大→中」
 *    回不到原值，越点越离谱。baseG 是 AI/食物库给的基准份，锚点只能是它。
 */

import { scaleFacts } from '../nutrition/calc';
import { tierGrams } from '../portion/tier';
import type { MealItem, PortionTier } from '../db/types';

export function setItemGrams(item: MealItem, grams: number): MealItem {
  const g = Math.max(0, Math.round(grams));
  return {
    ...item,
    grams: g,
    nutrition: scaleFacts(item.per100g, g),
    // 手动调过克数就是用户口径，档位不再代表真实份量
    gramSource: 'user',
  };
}

export function setItemTier(item: MealItem, tier: PortionTier): MealItem {
  // 固定份量（"1 瓶 500ml"）不参与缩放 —— 对它来说档位没有意义，
  // 缩放它就是凭空改掉用户明确说过的一份是多少
  if (item.scaleFixed) return item;

  const g = tierGrams(item.baseG, tier, item.scaleDamp ?? 1);
  return {
    ...item,
    grams: g,
    nutrition: scaleFacts(item.per100g, g),
    portionTier: tier,
    // 点了档位才算学习样本；默认中份是「没表态」
    tierConfirmed: true,
    gramSource: 'user',
  };
}

export function renameItem(item: MealItem, name: string): MealItem {
  return { ...item, name };
}

// ── 时间 ──────────────────────────────────────────────────
/**
 * 把「14:30」应用到某个时间戳上（只改时分，日期不变）。
 *
 * 改时间会连带改变这餐**归属哪一天**：凌晨 1 点的夜宵按 dayStartHour=4 算前一天。
 * 所以保存时必须用新的 eatenAt 重算 date，只改时分不改日期会记错天。
 */
export function applyClock(eatenAt: number, hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return eatenAt;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return eatenAt;
  const d = new Date(eatenAt);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

export function clockOf(eatenAt: number): string {
  const d = new Date(eatenAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
