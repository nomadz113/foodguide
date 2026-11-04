import type { NutrientKey, NutritionFacts } from '../core/nutrition/types';
import { isReliable } from '../core/nutrition/calc';

/** 14 格：13 项微量 + 膳食纤维 */
const CELLS: { key: NutrientKey; label: string }[] = [
  { key: 'calcium', label: '钙' },
  { key: 'iron', label: '铁' },
  { key: 'zinc', label: '锌' },
  { key: 'selenium', label: '硒' },
  { key: 'potassium', label: '钾' },
  { key: 'magnesium', label: '镁' },
  // 单字「纤」：14 格里只有它是两字标签，深色下「纤维 8.5」会把标签挤成两行，
  // 把同一行的高度顶高，其余 13 格跟着错位。其余单字（钙铁锌硒…）本来就是这个写法。
  { key: 'fiber', label: '纤' },
  { key: 'va', label: 'VA' },
  { key: 'vc', label: 'VC' },
  { key: 'vd', label: 'VD' },
  { key: 've', label: 'VE' },
  { key: 'b1', label: 'B1' },
  { key: 'b2', label: 'B2' },
  { key: 'niacin', label: '烟酸' },
];

function fmt(v: number): string {
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Math.round(v));
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export interface MicroGridProps {
  totals: NutritionFacts;
  coverage: Partial<Record<NutrientKey, number>>;
  targets: Partial<Record<NutrientKey, number | null>>;
}

/**
 * 14 格的读屏口径。
 *
 * 视觉上去掉了底色（那一组 14 个灰块曾是整屏最重的色块），但网格的「表」语义
 * 反过来必须显式写出来：读屏以前听到的是「钙 464 铁 3.9 锌 2.3…」——
 * 没有分组、没有单位、没有达标与否。role="list" + listitem 给它分组，
 * aria-label 把「项名 + 值 + 目标 + 是否达标」一次说清。
 *
 * 只加属性，**不改类名、不改 DOM 层级** —— tools/check-meal-micro.mjs 依赖
 * `.mgrid .mcell .lb .vv .dot` 这套结构，而它选择器失效时不会报错、只会返回空数组。
 */
export function MicroGrid({ totals, coverage, targets }: MicroGridProps) {
  // 库里 78 条食物已全部填齐 13 项微矿，所以「—」现在只可能来自一个原因：
  // 这餐的某个食材没匹配上食物库（自家做的菜、餐厅菜、模型起的新名字）。
  const knownCount = CELLS.filter(({ key }) => totals[key] != null && isReliable(coverage, key)).length;
  const sparse = knownCount < 4;

  return (
    <>
      <div className="mgrid" role="list" aria-label="微量营养素，14 项">
      {CELLS.map(({ key, label }) => {
        const value = totals[key];
        const target = targets[key] ?? null;
        const reliable = isReliable(coverage, key) && typeof value === 'number';
        const known = reliable && target != null && target > 0;

        if (!known) {
          return (
            <div
              key={key}
              className="mcell na"
              role="listitem"
              aria-label={`${label} 没有可靠数据，目标 ${target ?? '未知'}`}
            >
              {/* 圆点是纯装饰：达标与否已经写在 aria-label 里，读屏再念一遍只是噪音 */}
              <div className="dot" aria-hidden="true" />
              <div className="lb">{label}</div>
              <div className="vv">—</div>
            </div>
          );
        }

        const ratio = (value as number) / (target as number);
        return (
          <div
            key={key}
            className={`mcell ${ratio >= 0.9 ? 'hit' : ''}`}
            role="listitem"
            aria-label={`${label} ${fmt(value as number)}，目标 ${target}，${ratio >= 0.9 ? '已达标' : '未达标'}`}
          >
            <div className="dot" aria-hidden="true" />
            <div className="lb">{label}</div>
            <div className="vv">{fmt(value as number)}</div>
          </div>
        );
      })}
      </div>

      {sparse ? (
        <div className="hint" style={{ textAlign: 'left', marginTop: 9, lineHeight: 1.55 }}>
          拍照只估热量、蛋白、脂肪、碳水、纤维和钠，维生素矿物质按食物库补。这餐有几样没匹配上库里的食材，宁可用「—」空着，也不猜一个数填进去。
        </div>
      ) : (
        <div className="hint" style={{ textAlign: 'left', marginTop: 8, lineHeight: 1.5 }}>
          维生素矿物质取自食物成分表；复合菜按配料折算，误差约 ±20%。
        </div>
      )}
    </>
  );
}

/**
 * 折叠行上那一句摘要用的计数。
 *
 * 「达标」口径和格子里的高亮完全一致（≥90% 目标），两处各算一套迟早会不一致——
 * 摘要写「达标 8 项」而格子只亮 7 个，用户会以为丢了一格。
 */
export function microSummary(
  totals: NutritionFacts,
  coverage: Partial<Record<NutrientKey, number>>,
  targets: Partial<Record<NutrientKey, number | null>>,
): { known: number; hit: number; total: number } {
  let known = 0;
  let hit = 0;
  for (const { key } of CELLS) {
    const value = totals[key];
    const target = targets[key] ?? null;
    const reliable = isReliable(coverage, key) && typeof value === 'number';
    if (!reliable || target == null || target <= 0) continue;
    known += 1;
    if ((value as number) / target >= 0.9) hit += 1;
  }
  return { known, hit, total: CELLS.length };
}

/** 覆盖率不足的营养素数量，用于顶部提示「N 项数据不足」 */
export function unreliableCount(
  coverage: Partial<Record<NutrientKey, number>>,
  targets: Partial<Record<NutrientKey, number | null>>,
): number {
  return CELLS.filter((c) => {
    const t = targets[c.key];
    return t != null && t > 0 && !isReliable(coverage, c.key);
  }).length;
}
