import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../core/db/schema';
import { allFoods, recordTierSample, saveMeal, softDeleteMeal } from '../core/db/repo';
import { makeItem, retotalMeal, SLOT_LABELS } from '../core/meal/build';
import { applyClock, clockOf, renameItem, setItemGrams, setItemTier } from '../core/meal/edit';
import { searchFoods } from '../core/food/normalize';
import { scaleFacts } from '../core/nutrition/calc';
import { dayKey, formatDayLabel } from '../core/date';
import type { Food, MealItem, MealSlot, PortionTier } from '../core/db/types';
import { useAppData } from '../store/AppData';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const TIERS: PortionTier[] = ['small', 'medium', 'large'];
const TIER_LABEL: Record<PortionTier, string> = { small: '小份', medium: '中份', large: '大份' };

interface Draft {
  slot: MealSlot;
  eatenAt: number;
  items: MealItem[];
}

/**
 * 编辑已经记下的一餐。
 *
 * 为什么单独做一页而不是复用拍照流程：改的是「已经发生的事实」——
 * 当时吃的量记错了、档位点错了、这餐其实是加餐不是午餐。
 * 重算只走 scaleFacts(per100g, grams)，绝不重新问 AI：
 * 重新识别一次既花钱又可能给出不同的数，那不叫修正，叫覆盖。
 */
export function MealEditPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { settings } = useAppData();
  const meal = useLiveQuery(() => db.meals.get(id), [id]);
  const foods = useLiveQuery(() => allFoods(), []);

  const [draft, setDraft] = useState<Draft | null>(null);
  /** 本次点过的档位（itemId → 档位）：只有真点过的才进学习样本 */
  const [touched, setTouched] = useState<Record<string, PortionTier>>({});
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // 库里的数据是异步到的，只在它首次到达时建草稿 ——
  // 之后 draft 就是唯一真相，否则用户改到一半会被库里的旧值冲掉
  useEffect(() => {
    if (!meal || draft) return;
    setDraft({ slot: meal.slot, eatenAt: meal.eatenAt, items: meal.items });
  }, [meal, draft]);

  const results = useMemo(() => (query && foods ? searchFoods(query, foods) : []), [query, foods]);

  if (!meal) {
    return <div className="main center">读取中…</div>;
  }
  if (!draft) {
    return <div className="main center">读取中…</div>;
  }

  const patch = (items: MealItem[]) => setDraft((d) => (d ? { ...d, items } : d));

  const editItem = (itemId: string, fn: (it: MealItem) => MealItem) => {
    patch(draft.items.map((it) => (it.id === itemId ? fn(it) : it)));
  };

  const addFood = (f: Food) => {
    const baseG = f.serving?.grams ?? 100;
    const it = makeItem({
      name: f.name,
      per100g: f.per100g,
      baseG,
      grams: baseG,
      foodId: f.id,
      matchType: 'library',
      gramSource: 'user',
    });
    patch([...draft.items, it]);
    setQuery('');
  }

  const save = async () => {
    if (saving || draft.items.length === 0) return;
    setSaving(true);
    try {
      // 改时间可能改变这餐归属哪一天（凌晨 1 点按 dayStartHour=4 算前一天），
      // date 必须用新的 eatenAt 重算，只改时分不改 date 会记错天
      const next = retotalMeal({
        ...meal,
        slot: draft.slot,
        eatenAt: draft.eatenAt,
        date: dayKey(new Date(draft.eatenAt), settings.dayStartHour),
        items: draft.items,
      });
      await saveMeal(next);

      for (const [itemId, tier] of Object.entries(touched)) {
        const it = draft.items.find((x) => x.id === itemId);
        if (it?.foodId) await recordTierSample(it.foodId, tier);
      }
      nav('/');
    } finally {
      setSaving(false);
    }
  };

  const removeMeal = async () => {
    if (!window.confirm('删除这一餐？记录只是被标记为删除，但今日页不会再显示它。')) return;
    await softDeleteMeal(id);
    nav('/');
  };

  const totals = draft.items.reduce(
    (acc, it) => {
      const f = scaleFacts(it.per100g, it.grams);
      acc.kcal += f.kcal ?? 0;
      acc.protein += f.protein ?? 0;
      acc.fat += f.fat ?? 0;
      acc.carbs += f.carbs ?? 0;
      return acc;
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );

  const belongsTo = dayKey(new Date(draft.eatenAt), settings.dayStartHour);

  return (
    <>
      <div className="hdr">
        <div>
          <h1>编辑这一餐</h1>
          <div className="sub">
            {SLOT_LABELS[draft.slot]} · {draft.items.length} 项 · 归属 {formatDayLabel(belongsTo)}
          </div>
        </div>
        <button
          className="pill ok"
          disabled={saving || draft.items.length === 0}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      <div className="main">
        <div className="flabel">餐次</div>
        <div className="seg">
          {SLOTS.map((s) => (
            <button
              key={s}
              className={draft.slot === s ? 'on' : ''}
              onClick={() => setDraft((d) => (d ? { ...d, slot: s } : d))}
            >
              {SLOT_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="flabel">用餐时间</div>
        <div className="field">
          <span>改到凌晨会算进前一天（按凌晨 {settings.dayStartHour} 点切日）</span>
          <input
            type="time"
            value={clockOf(draft.eatenAt)}
            onChange={(e) =>
              setDraft((d) => (d ? { ...d, eatenAt: applyClock(d.eatenAt, e.target.value) } : d))
            }
          />
        </div>

        <div className="flabel">这一餐吃了什么</div>
        {draft.items.map((it) => {
          const f = scaleFacts(it.per100g, it.grams);
          const step = it.baseG <= 60 ? 5 : 10;
          return (
            <div className="selitem" key={it.id} style={{ marginTop: 0, marginBottom: 7 }}>
              <div className="top">
                <input
                  value={it.name}
                  aria-label="食物名称"
                  onChange={(e) => editItem(it.id, (x) => renameItem(x, e.target.value))}
                />
                <span className="kc">{Math.round(f.kcal ?? 0)} kcal</span>
                <button className="rm" aria-label="删除这项" onClick={() => patch(draft.items.filter((x) => x.id !== it.id))}>×</button>
              </div>
              <div className="ctl">
                <div className="stepper">
                  <button onClick={() => editItem(it.id, (x) => setItemGrams(x, x.grams - step))}>−</button>
                  <b>{it.grams}g</b>
                  <button onClick={() => editItem(it.id, (x) => setItemGrams(x, x.grams + step))}>+</button>
                </div>
                {!it.scaleFixed && (
                  <div className="tiers3">
                    {TIERS.map((t) => (
                      <button
                        key={t}
                        className={it.portionTier === t ? 'on' : ''}
                        onClick={() => {
                          editItem(it.id, (x) => setItemTier(x, t));
                          setTouched((prev) => ({ ...prev, [it.id]: t }));
                        }}
                      >
                        {TIER_LABEL[t]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {draft.items.length === 0 && (
          <div className="empty">
            这一餐还没有任何食物。<br />从下面加一项，或者直接删掉这一餐。
          </div>
        )}

        <div className="flabel">再加一项</div>
        <div className="searchbox">
          <span style={{ color: 'var(--mute)' }}>⌕</span>
          <input
            value={query}
            placeholder="搜索食物，如 米饭 / 鸡胸肉"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button style={{ color: 'var(--mute)' }} onClick={() => setQuery('')}>×</button>}
        </div>

        {query && results.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {results.slice(0, 8).map((f) => (
              <div className="pickrow" key={f.id}>
                <div className="info">
                  <b>{f.name}</b>
                  <small>
                    {typeof f.per100g.kcal === 'number' ? Math.round(f.per100g.kcal) : '—'} kcal / 100g
                    {f.serving ? ` · 一份 ${f.serving.grams}g` : ''}
                  </small>
                </div>
                <button className="add" aria-label="加入" onClick={() => addFood(f)}>+</button>
              </div>
            ))}
          </div>
        )}

        <div className="card" style={{ marginTop: 14 }}>
          <div className="title row">
            <span>改后合计</span>
            <span style={{ fontSize: 10, color: 'var(--mute)' }}>保存后才生效</span>
          </div>
          <div className="krow">
            <span className="k">热量</span>
            <span className="v">{Math.round(totals.kcal)}<small>kcal</small></span>
          </div>
          <div className="krow">
            <span className="k">蛋白 / 脂肪 / 碳水</span>
            <span className="v" style={{ fontSize: 11.5 }}>
              {Math.round(totals.protein)} / {Math.round(totals.fat)} / {Math.round(totals.carbs)} g
            </span>
          </div>
        </div>

        <button
          style={{ width: '100%', marginTop: 16, padding: '12px 0', fontSize: 12.5, color: '#fca5a5' }}
          onClick={() => void removeMeal()}
        >
          删除这一餐
        </button>

        <div className="hint">
          营养按「每 100g × 克数」重算，不会重新问 AI —— 修正不该把原来的判断冲掉。
        </div>

        <button
          style={{ width: '100%', marginTop: 10, padding: '12px 0', fontSize: 12.5, color: 'var(--dim)' }}
          onClick={() => nav('/')}
        >
          返回
        </button>
      </div>
    </>
  );
}
