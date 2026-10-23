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
  { key: 'fiber', label: '纤维' },
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

export function MicroGrid({ totals, coverage, targets }: MicroGridProps) {
  // 库里 78 条食物已全部填齐 13 项微矿，所以「—」现在只可能来自一个原因：
  // 这餐的某个食材没匹配上食物库（自家做的菜、餐厅菜、模型起的新名字）。
  const knownCount = CELLS.filter(({ key }) => totals[key] != null && isReliable(coverage, key)).length;
  const sparse = knownCount < 4;

  return (
    <>
      <div className="mgrid">
      {CELLS.map(({ key, label }) => {
        const value = totals[key];
        const target = targets[key] ?? null;
        const reliable = isReliable(coverage, key) && typeof value === 'number';
        const known = reliable && target != null && target > 0;

        if (!known) {
          return (
            <div key={key} className="mcell na">
              <div className="dot" />
              <div className="lb">{label}</div>
              <div className="vv">—</div>
            </div>
          );
        }

        const ratio = (value as number) / (target as number);
        return (
          <div key={key} className={`mcell ${ratio >= 0.9 ? 'hit' : ''}`}>
            <div className="dot" />
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
        <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 8, lineHeight: 1.5 }}>
          维生素矿物质取自食物成分表；复合菜按配料折算，误差约 ±20%。
        </div>
      )}
    </>
  );
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
