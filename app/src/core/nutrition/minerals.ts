/**
 * 「这一餐的矿物质」展示层 —— 纯函数，可被 vitest 直接测。
 *
 * 为什么单独一层：MealEdit 要同时回答两个问题，
 *  ① 这一项食物匹配到了哪几项矿物质？（逐项）
 *  ② 这一餐加起来补了多少、占全天多少？（汇总）
 * 两者都只是「把 MealItem 里已有的数搬出来」，但搬法有讲究：
 *
 * - **只列已知项，不用 0 占位**。0 表示「化学上不含」，null 表示「不知道」，
 *   把一个没匹配上的食物显示成「钙 0mg」是在编数据。
 * - **汇总的 coverage 来自 aggregate**，复用它算出的「已知克重占比」，
 *   这样「没匹配上的食材没计入」这件事有据可依，而不是嘴上说说。
 * - **钠不在这里**。钠是 AI 按油盐估的，不是从食物库匹配来的，
 *   混进「匹配到的矿物质」会让人以为它也有库数据。
 */

import type { MealItem } from '../db/types';
import { aggregate } from './calc';
import {
  NUTRIENT_LABELS, NUTRIENT_UNITS, isKnown,
  type NutritionFacts, type NutrientKey,
} from './types';

/** 六项矿物质，展示顺序固定 */
export const MINERAL_KEYS = [
  'calcium', 'iron', 'zinc', 'selenium', 'potassium', 'magnesium',
] as const;

export type MineralKey = (typeof MINERAL_KEYS)[number];

/**
 * 显示用数字：≥10 取整，<10 保一位小数，整数不拖 .0。
 * 与首页 MicroGrid 的 fmt 不同 —— 那里是 14 格窄格子，这里带「mg」单位，
 * 「6.0mg」比「6mg」多一个字符却没有任何信息量。
 */
export function fmtMineral(v: number): string {
  if (v >= 10) return String(Math.round(v));
  const r = Math.round(v * 10) / 10;
  // 极小的非零值不能显示成「0」：那等于宣称测到了零
  if (r === 0 && v > 0) return '<0.1';
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export interface MineralChip {
  key: MineralKey;
  label: string;
  unit: string;
  value: number;
}

export interface ItemMineralLine {
  chips: MineralChip[];
  /** 六项里有几项没有数据 */
  missing: number;
  /** 六项全空时的解释文案；有值时 null */
  emptyReason: string | null;
}

/**
 * 单项食物匹配到的矿物质。
 *
 * 只读 `nutrition`（绝对量快照，已按克数缩放），不读 `fieldSource`：
 * 有值的矿物质实际上都来自食物库（AI 只给宏量与钠），
 * 逐项标来源只会给每一项加一个没有信息量的标记。
 */
export function itemMinerals(it: MealItem): ItemMineralLine {
  const chips: MineralChip[] = [];
  for (const key of MINERAL_KEYS) {
    const v = it.nutrition[key];
    if (!isKnown(v)) continue;
    chips.push({
      key,
      label: NUTRIENT_LABELS[key],
      unit: NUTRIENT_UNITS[key],
      value: v,
    });
  }
  return {
    chips,
    missing: MINERAL_KEYS.length - chips.length,
    emptyReason: chips.length > 0 ? null : explainEmpty(it),
  };
}

/**
 * 全空有两种原因，说出来的是哪一种很重要：
 * 库里压根没有这种食物（孜然粉），还是库里有这条但没录矿物质（老条目）。
 * 合并成一句「没有数据」会让人以为食物库很薄，实际可能只是没匹配上名字。
 */
function explainEmpty(it: MealItem): string {
  const matched = it.matchType === 'library' && it.foodId != null;
  if (matched) {
    return `食物库里「${it.name}」这条没有矿物质数据，6 项留空；热量和三大宏量不受影响`;
  }
  return `食物库里没有「${it.name}」，6 项留空；热量和三大宏量不受影响`;
}

export interface MineralTotal {
  key: MineralKey;
  label: string;
  unit: string;
  /** 本餐已知部分之和；六项皆未知时为 null（不是 0） */
  value: number | null;
  /** 占全天目标的百分比；目标缺失或值为 null 时为 null */
  pct: number | null;
  /** 已知克重占比 0~1 */
  coverage: number;
}

export interface MealMineralSummary {
  cells: MineralTotal[];
  /** 六项里至少有一项有数据的食物项数 */
  itemsWithData: number;
  itemCount: number;
  /** 有值但没被全部食材覆盖 → 汇总只是下限 */
  partial: boolean;
}

export function mealMinerals(
  items: MealItem[],
  targets: Partial<NutritionFacts> = {},
): MealMineralSummary {
  const { totals, coverage } = aggregate(items);

  const cells: MineralTotal[] = MINERAL_KEYS.map((key) => {
    const v = totals[key];
    const t = targets[key as NutrientKey];
    const target = isKnown(t) && t > 0 ? t : null;
    const value = isKnown(v) ? v : null;
    return {
      key,
      label: NUTRIENT_LABELS[key],
      unit: NUTRIENT_UNITS[key],
      value,
      pct: value != null && target != null ? (value / target) * 100 : null,
      coverage: coverage[key] ?? 0,
    };
  });

  return {
    cells,
    itemsWithData: items.filter((it) => MINERAL_KEYS.some((k) => isKnown(it.nutrition[k]))).length,
    itemCount: items.length,
    partial: cells.some((c) => c.value != null && c.coverage < 1),
  };
}

/** 占比文案。四舍五入到 1% 会把 0.7% 说成 1%，不足 1% 就如实写 */
export function fmtPct(pct: number | null): string {
  if (pct == null) return '占全天 —';
  if (pct < 1) return '占全天 <1%';
  return `占全天 ${Math.round(pct)}%`;
}

/**
 * 逐项文字每行放几项。
 *
 * 写死 5 而不交给浏览器折行：同一份数据在不同屏宽下会折成 4+2、3+3、甚至 5+1 里
 * 另一项被挤到第三行，排版不稳定。固定 5 项后，390px 下第一行满、第二行只余最长
 * 那项（镁），读起来是「一行五项 + 一行补齐」。
 */
export const MINERALS_PER_ROW = 5;

/** 按每行 n 项切行；空数组返回空数组（不造出一个空行） */
export function chunkMinerals<T>(list: T[], size = MINERALS_PER_ROW): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

/** 进度条宽度：超过 100% 截断，否则条会溢出格子 */
export function barWidth(pct: number | null): number {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(100, pct);
}
