import type { MacroKey, NutritionFacts } from '../core/nutrition/types';
import { MACRO_LABELS } from '../core/nutrition/calc';

const COLORS: Record<MacroKey, string> = {
  protein: 'linear-gradient(90deg,#60a5fa,#3b82f6)',
  fat: 'linear-gradient(90deg,#fbbf24,#f59e0b)',
  carbs: 'linear-gradient(90deg,#a78bfa,#8b5cf6)',
};

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
              <span className="fill" style={{ width: `${pct * 100}%`, background: COLORS[k] }} />
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
