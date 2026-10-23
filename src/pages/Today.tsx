import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { mealsOfDay, softDeleteMeal } from '../core/db/repo';
import { SLOT_LABELS, slotTotals, sumMeals } from '../core/meal/build';
import { sodiumToSalt } from '../core/nutrition/calc';
import { localAdvice } from '../core/advice/local';
import { formatClock, formatDayLabel } from '../core/date';
import type { NutrientKey } from '../core/nutrition/types';
import { useAppData } from '../store/AppData';
import { Ring } from '../ui/Ring';
import { MacroRows } from '../ui/MacroRows';
import { MicroGrid } from '../ui/MicroGrid';
import { AdviceCard } from '../ui/AdviceCard';

const SLOT_ICON: Record<string, string> = {
  breakfast: '☀', lunch: '◐', dinner: '☾', snack: '✚',
};

export function TodayPage() {
  const { profile, goal, today } = useAppData();
  const nav = useNavigate();
  const meals = useLiveQuery(() => mealsOfDay(today), [today]);

  if (!meals) return <div className="main center">读取中…</div>;

  const sum = sumMeals(meals);
  const t = sum.totals;
  const kcal = typeof t.kcal === 'number' ? t.kcal : 0;
  const protein = typeof t.protein === 'number' ? t.protein : 0;
  const fiber = typeof t.fiber === 'number' ? t.fiber : 0;

  const microTargets: Partial<Record<NutrientKey, number | null>> = {
    ...goal.micro,
    fiber: goal.fiberG,
  };

  const sodium = typeof t.sodium === 'number' ? t.sodium : null;
  const sodiumPct = sodium != null ? Math.min(sodium / goal.sodiumLimitMg, 1) : 0;
  const sodiumLeft = sodium != null ? goal.sodiumLimitMg - sodium : goal.sodiumLimitMg;

  const advice = localAdvice({ kcal, protein, fiber, mealCount: sum.mealCount, goal });
  const slots = slotTotals(meals);
  const planLine = (['breakfast', 'lunch', 'dinner', 'snack'] as const)
    .filter((s) => slots[s] > 0)
    .map((s) => `${SLOT_LABELS[s]} ${Math.round(slots[s])}`)
    .join(' · ');

  async function remove(id: string, kcalOf: number) {
    if (!window.confirm(`删除这条记录（${Math.round(kcalOf)} kcal）？`)) return;
    await softDeleteMeal(id);
  }

  return (
    <>
      <div className="hdr">
        <div>
          <h1>{formatDayLabel(today)}</h1>
          <div className="sub">
            {profile.goalType === 'lose' ? '减脂' : profile.goalType === 'gain' ? '增肌' : profile.goalType === 'maintain' ? '维持' : '健康改善'}
            {' · '}
            {sum.mealCount > 0 ? `${sum.mealCount} 餐 · ${sum.itemCount} 项` : '尚未记录'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`pill ${kcal > goal.kcal ? 'bad' : 'ok'}`}>
            {kcal > goal.kcal ? `超出 ${Math.round(kcal - goal.kcal)}` : `剩 ${Math.round(goal.kcal - kcal)}`} kcal
          </span>
          <button
            aria-label="拍照识别"
            onClick={() => nav('/capture')}
            style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--card)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}
          >
            ⌾
          </button>
        </div>
      </div>

      <div className="main">
        <Ring value={kcal} target={goal.kcal} />

        <div className="card" style={{ marginTop: 6 }}>
          <MacroRows totals={t} targets={{ protein: goal.proteinG, fat: goal.fatG, carbs: goal.carbsG }} />
        </div>

        {/* 钠：上限型指标，用反向余量条 */}
        <div className="card">
          <div className="na-hd">
            <span className="k">钠（上限 {goal.sodiumLimitMg.toLocaleString()} mg）</span>
            <span className="v">
              {sodium != null ? (
                <>已摄入 <b>{Math.round(sodium)}</b> mg · 折合盐 {sodiumToSalt(sodium).toFixed(1)}g</>
              ) : '暂无数据'}
            </span>
          </div>
          <div className="na-track">
            <div className="na-fill" style={{ width: `${sodiumPct * 100}%` }} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--mute)', marginTop: 6 }}>
            {sodium == null
              ? '记录里没有钠数据，无法判断'
              : sodiumLeft >= 0
                ? `还可用 ${Math.round(sodiumLeft)} mg，约 ${sodiumToSalt(sodiumLeft).toFixed(1)}g 盐`
                : `已超出 ${Math.round(-sodiumLeft)} mg，约 ${sodiumToSalt(-sodiumLeft).toFixed(1)}g 盐`}
          </div>
        </div>

        <div className="card">
          <div className="title row">
            <span>微量营养素</span>
            <span style={{ fontSize: 10, color: 'var(--mute)' }}>— 表示数据不足</span>
          </div>
          <MicroGrid totals={t} coverage={sum.coverage} targets={microTargets} />
        </div>

        <AdviceCard
          local={advice}
          totals={t}
          coverage={sum.coverage}
          meals={meals}
          profile={profile}
          goal={goal}
          planLine={planLine}
        />

        <div className="card" style={{ background: 'none', border: 0, padding: 0, marginTop: 14 }}>
          <div className="title row" style={{ padding: '0 2px', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--dim)', fontWeight: 650 }}>今日记录</span>
            <button style={{ fontSize: 11, color: 'var(--green)' }} onClick={() => nav('/add')}>
              记一餐
            </button>
          </div>

          {meals.length === 0 ? (
            <div className="empty">
              <span className="ic">◷</span>
              还没有记录。<br />点中间的 + 拍一张，或者跟小助手说一句。
            </div>
          ) : (
            meals.map((m) => {
              const k = typeof m.totals.kcal === 'number' ? m.totals.kcal : 0;
              const names = m.items.map((i) => i.name).join(' · ');
              return (
                <div className="meal" key={m.id}>
                  <div className="thumb">{SLOT_ICON[m.slot] ?? '·'}</div>
                  <div className="info">
                    <div className="n">{names || '未命名'}</div>
                    <div className="d">
                      {formatClock(m.eatenAt)} · {SLOT_LABELS[m.slot]} · {m.items.length} 项
                    </div>
                  </div>
                  <div className="kcal">
                    <b>{Math.round(k)}</b>
                    <span>kcal</span>
                  </div>
                  <button
                    className="edit"
                    aria-label="编辑"
                    title="编辑这一餐"
                    onClick={() => nav(`/meal/${m.id}`)}
                  >
                    ✎
                  </button>
                  <button className="del" aria-label="删除" onClick={() => void remove(m.id, k)}>×</button>
                </div>
              );
            })
          )}
        </div>

        <div className="hint">
          份量靠估算，误差客观存在。记录的价值在于趋势，不在单餐精确到克。
        </div>
      </div>
    </>
  );
}

