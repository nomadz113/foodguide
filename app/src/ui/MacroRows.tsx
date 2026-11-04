import type { MacroKey, NutritionFacts } from '../core/nutrition/types';
import { MACRO_LABELS } from '../core/nutrition/calc';

// 只有 class 名：渐变本体在 index.css 里（--macro-*），浅色版要单独调深一档。
// 写死在这里的话，浅色下 #fbbf24 这种亮黄条在白底上几乎看不见。
const ORDER: MacroKey[] = ['protein', 'fat', 'carbs'];

export function MacroRows({
  totals,
  targets,
}: {
  totals: NutritionFacts;
  targets: Partial<Record<MacroKey, number | null>>;
}) {
  return (
    <div>
      {ORDER.map((k) => {
        const raw = totals[k];
        const value = typeof raw === 'number' ? raw : 0;
        const target = targets[k] ?? null;
        const pct = target && target > 0 ? Math.min(value / target, 1) : 0;
        return (
          <div className="mrow" key={k}>
            <span className="lbl">{MACRO_LABELS[k].replace('蛋白质', '蛋白')}</span>
            <span className="track">
              <span className={`fill ${k}`} style={{ width: `${pct * 100}%` }} />
            </span>
            <span className="val">
              <b>{Math.round(value)}</b>
              {target != null ? ` / ${Math.round(target)}` : ' / —'} g
            </span>
          </div>
        );
      })}
    </div>
  );
}
