/**
 * 「今日来源 TOP3」—— 纯函数，不碰 IO。
 *
 * 回答两个问题：今天的热量主要来自哪几样、脂肪主要来自哪几样。
 *
 * 三条口径（改动前必须先知道）：
 * 1. **同名合并**：同一种食物当天出现多次要合成一项。
 *    否则「早中晚三碗米饭」会把前三名占满，榜单就退化成「米饭榜」。
 * 2. **拆解按食材计**：复合菜在记录里已经拆成 番茄 / 鸡蛋 / 油 三条，
 *    这里按条目统计，所以「油」能单独上脂肪榜 ——
 *    这正是「拍照必须拆油」想要的引导力：用户看得到油从哪来，才会去少点一勺。
 * 3. **分母是当日总量**：百分比 = 这一项 / 当天该项总和，不是「在榜单内部占多少」。
 *    轨道长度也按这个百分比画，**不做「第一名满格」归一化** ——
 *    那样 32% 会画成满条，数字和图形说两套话。
 *
 * 与首页宏量条同一个约定：fill 宽 = 值/目标（这里是值/当日总量）。
 */

import { normalizeName } from '../food/normalize';
import { sumMeals } from '../meal/build';
import { isReliable } from '../nutrition/calc';
import type { Meal } from '../db/types';

export type TopKey = 'kcal' | 'fat';

export interface TopEntry {
  name: string;
  /** 绝对量（kcal 或 g） */
  value: number;
  /** 占当日该项总量的百分比，整数 */
  pct: number;
}

/** 这一榜为什么出不来 */
export type TopUnavailable = 'few' | 'coverage';

export interface TopGroup {
  key: TopKey;
  label: string;
  unit: string;
  /** 当日该项总量（分母） */
  total: number;
  /** null = 这一榜出不来，原因见 reason */
  entries: TopEntry[] | null;
  reason: TopUnavailable | null;
}

export interface TopSources {
  kcal: TopGroup;
  fat: TopGroup;
  /** 两榜都出不来时整块不渲染 */
  visible: boolean;
}

const TOP_N = 3;

interface Bucket {
  /** 展示名：取该组第一次出现的写法 */
  name: string;
  kcal: number;
  fat: number;
  /** 该项是否有已知值（null ≠ 0，缺失不参与累加） */
  kcalKnown: boolean;
  fatKnown: boolean;
}

/** 按归一化名归组：同名合并 */
function collect(meals: Meal[]): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  for (const meal of meals) {
    for (const it of meal.items) {
      const key = normalizeName(it.name);
      if (!key) continue;
      let b = out.get(key);
      if (!b) {
        b = { name: it.name.trim(), kcal: 0, fat: 0, kcalKnown: false, fatKnown: false };
        out.set(key, b);
      }
      const k = it.nutrition.kcal;
      if (typeof k === 'number' && Number.isFinite(k)) {
        b.kcal += k;
        b.kcalKnown = true;
      }
      const f = it.nutrition.fat;
      if (typeof f === 'number' && Number.isFinite(f)) {
        b.fat += f;
        b.fatKnown = true;
      }
    }
  }
  return out;
}

function buildGroup(
  key: TopKey,
  buckets: Bucket[],
  total: number,
  reliable: boolean,
): TopGroup {
  const label = key === 'kcal' ? '热量' : '脂肪';
  const unit = key === 'kcal' ? 'kcal' : 'g';
  const base = { key, label, unit, total: Math.round(total) };

  // 数据覆盖率不足：宁可这一榜显示「—」，也不拿半份数据当全天说
  if (!reliable) return { ...base, entries: null, reason: 'coverage' };

  const rows = buckets
    .filter((b) => (key === 'kcal' ? b.kcalKnown : b.fatKnown) && b[key] > 0)
    .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name, 'zh-CN'));

  // 只有两样东西时「TOP3」是伪信息
  if (rows.length < TOP_N) return { ...base, entries: null, reason: 'few' };

  const entries = rows.slice(0, TOP_N).map((b) => ({
    name: b.name,
    value: Math.round(b[key]),
    pct: total > 0 ? Math.round((b[key] / total) * 100) : 0,
  }));
  return { ...base, entries, reason: null };
}

export function computeTopSources(meals: Meal[]): TopSources {
  const buckets = [...collect(meals).values()];
  const { coverage } = sumMeals(meals);

  const totalKcal = buckets.reduce((s, b) => s + (b.kcalKnown ? b.kcal : 0), 0);
  const totalFat = buckets.reduce((s, b) => s + (b.fatKnown ? b.fat : 0), 0);

  const kcal = buildGroup('kcal', buckets, totalKcal, isReliable(coverage, 'kcal'));
  const fat = buildGroup('fat', buckets, totalFat, isReliable(coverage, 'fat'));

  return { kcal, fat, visible: kcal.entries !== null || fat.entries !== null };
}
