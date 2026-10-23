import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { allFoods, bumpFoodUsage, recordTierSample, saveMeal, upsertFood } from '../core/db/repo';
import { makeItem, makeMeal } from '../core/meal/build';
import { searchFoods } from '../core/food/normalize';
import { tierGrams } from '../core/portion/tier';
import { scaleFacts } from '../core/nutrition/calc';
import { facts, type NutritionFacts } from '../core/nutrition/types';
import type { Food, MealSlot, PortionTier } from '../core/db/types';
import { guessSlot } from '../core/date';
import { useAppData } from '../store/AppData';

interface Draft {
  key: string;
  name: string;
  per100g: NutritionFacts;
  baseG: number;
  grams: number;
  tier: PortionTier;
  tierConfirmed: boolean;
  foodId: string | null;
  damp?: number;
  fixed?: boolean;
}

const SLOTS: { key: MealSlot; label: string }[] = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '加餐' },
];

const QUICK = ['米饭', '鸡蛋', '鸡胸肉', '豆浆', '番茄', '苹果', '大豆油'];

function per100Label(f: Food): string {
  const k = f.per100g.kcal;
  return `${typeof k === 'number' ? Math.round(k) : '—'} kcal / 100g`;
}

export function AddMealPage() {
  const { goal, today } = useAppData();
  const nav = useNavigate();
  const foods = useLiveQuery(() => allFoods(), []);

  const [slot, setSlot] = useState<MealSlot>(guessSlot());
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft[]>([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const results = useMemo(
    () => (foods ? searchFoods(query, foods) : []),
    [foods, query],
  );

  function add(f: Food) {
    const baseG = f.serving?.grams ?? 100;
    setDraft((prev) => [
      ...prev,
      {
        key: `${f.id}_${Date.now()}_${prev.length}`,
        name: f.name,
        per100g: f.per100g,
        baseG,
        grams: baseG,
        tier: 'medium',
        tierConfirmed: false,
        foodId: f.id,
      },
    ]);
    setQuery('');
  }

  function setTier(key: string, tier: PortionTier) {
    setDraft((prev) =>
      prev.map((d) => {
        if (d.key !== key) return d;
        // 切档以 baseG 为锚重算，不从当前 grams 累乘
        return { ...d, tier, grams: tierGrams(d.baseG, tier, d.damp ?? 1), tierConfirmed: true };
      }),
    );
  }

  function bump(key: string, delta: number) {
    setDraft((prev) =>
      prev.map((d) => (d.key === key ? { ...d, grams: Math.max(0, d.grams + delta) } : d)),
    );
  }

  function remove(key: string) {
    setDraft((prev) => prev.filter((d) => d.key !== key));
  }

  const totalKcal = draft.reduce((acc, d) => {
    const k = scaleFacts(d.per100g, d.grams).kcal;
    return acc + (typeof k === 'number' ? k : 0);
  }, 0);

  const macroSum = draft.reduce(
    (acc, d) => {
      const f = scaleFacts(d.per100g, d.grams);
      acc.protein += f.protein ?? 0;
      acc.fat += f.fat ?? 0;
      acc.carbs += f.carbs ?? 0;
      return acc;
    },
    { protein: 0, fat: 0, carbs: 0 },
  );

  async function save() {
    if (draft.length === 0 || saving) return;
    setSaving(true);
    try {
      const items = draft.map((d) => {
        const it = makeItem(
          {
            name: d.name,
            per100g: d.per100g,
            baseG: d.baseG,
            grams: d.grams,
            foodId: d.foodId,
            matchType: d.foodId ? 'library' : 'manual',
            gramSource: 'user',
            scaleDamp: d.damp,
            scaleFixed: d.fixed,
          },
          d.tier,
        );
        return { ...it, tierConfirmed: d.tierConfirmed };
      });

      const meal = makeMeal({ items, slot, source: 'manual', goalId: goal.id, date: today });
      await saveMeal(meal);

      for (const d of draft) {
        if (!d.foodId) continue;
        await bumpFoodUsage(d.foodId);
        // 只有用户真点过档位才进学习样本
        if (d.tierConfirmed) await recordTierSample(d.foodId, d.tier);
      }
      nav('/');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app">
      <div className="sheetbar">
        <button onClick={() => nav(-1)}>取消</button>
        <h2>记一餐</h2>
        <button className="primary" disabled={draft.length === 0 || saving} onClick={() => void save()}>
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      <div className="main">
        <div className="seg" style={{ marginTop: 12 }}>
          {SLOTS.map((s) => (
            <button key={s.key} className={slot === s.key ? 'on' : ''} onClick={() => setSlot(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="searchbox">
          <span style={{ color: 'var(--mute)' }}>⌕</span>
          <input
            value={query}
            placeholder="搜索食物，如 米饭 / 鸡胸肉"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button style={{ color: 'var(--mute)' }} onClick={() => setQuery('')}>×</button>
          )}
        </div>

        {draft.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ fontSize: 11, color: 'var(--mute)', padding: '0 2px 2px' }}>
              <span>已选 {draft.length} 项</span>
              <span>点档位快速切份量</span>
            </div>
            {draft.map((d) => {
              const f = scaleFacts(d.per100g, d.grams);
              const step = d.baseG <= 60 ? 5 : 10;
              return (
                <div className="selitem" key={d.key} style={{ marginTop: 7 }}>
                  <div className="top">
                    <b>{d.name}</b>
                    <span className="kc">{Math.round(f.kcal ?? 0)} kcal</span>
                    <button className="rm" onClick={() => remove(d.key)}>×</button>
                  </div>
                  <div className="ctl">
                    <div className="stepper">
                      <button onClick={() => bump(d.key, -step)}>−</button>
                      <b>{d.grams}g</b>
                      <button onClick={() => bump(d.key, step)}>+</button>
                    </div>
                    <div className="tiers3">
                      {(['small', 'medium', 'large'] as PortionTier[]).map((t) => (
                        <button
                          key={t}
                          className={d.tier === t ? 'on' : ''}
                          onClick={() => setTier(d.key, t)}
                        >
                          {t === 'small' ? '小份' : t === 'medium' ? '中份' : '大份'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {query ? (
            results.length > 0 ? (
              <>
                {results.map((f) => (
                  <div className="pickrow" key={f.id}>
                    <div className="info">
                      <b>{f.name}</b>
                      <small>
                        {per100Label(f)}
                        {f.serving ? ` · 一份 ${f.serving.quantity}${f.serving.unit} ${f.serving.grams}g` : ''}
                      </small>
                    </div>
                    <button className="add" onClick={() => add(f)}>+</button>
                  </div>
                ))}
                <button
                  style={{ marginTop: 12, fontSize: 12, color: 'var(--green)', padding: '4px 2px' }}
                  onClick={() => setCreating(true)}
                >
                  找不到？手动新建「{query}」
                </button>
              </>
            ) : (
              <div className="empty">
                没找到「{query}」。
                <br />
                <button
                  style={{ marginTop: 10, color: 'var(--green)', fontSize: 13 }}
                  onClick={() => setCreating(true)}
                >
                  手动新建这个食物
                </button>
              </div>
            )
          ) : (
            <>
              <div className="row" style={{ fontSize: 11, color: 'var(--mute)', padding: '0 2px' }}>
                <span>常用</span>
                <span>内置 {foods?.length ?? 0} 条</span>
              </div>
              <div className="suggest">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      const hit = foods?.find((f) => f.name === q);
                      if (hit) add(hit);
                      else setQuery(q);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {creating && (
          <NewFoodForm
            initialName={query}
            onCancel={() => setCreating(false)}
            onCreate={async (name, p100, baseG) => {
              const food = await upsertFood({ name, per100g: p100, source: 'custom', category: '自定义' });
              setCreating(false);
              setQuery('');
              setDraft((prev) => [
                ...prev,
                {
                  key: `${food.id}_${Date.now()}`,
                  name: food.name,
                  per100g: food.per100g,
                  baseG,
                  grams: baseG,
                  tier: 'medium',
                  tierConfirmed: false,
                  foodId: food.id,
                },
              ]);
            }}
          />
        )}

        <div className="hint">份量以克为准。改档位后仍可微调，微调的值优先。</div>
      </div>

      <div className="totalbar standalone">
        <div>
          <div className="k">本餐合计</div>
          <b>{Math.round(totalKcal)}<span style={{ fontSize: 11, color: 'var(--mute)', marginLeft: 3 }}>kcal</span></b>
        </div>
        <div className="macros">
          <span>蛋白 {Math.round(macroSum.protein)}g</span>
          <span>脂肪 {Math.round(macroSum.fat)}g</span>
          <span>碳水 {Math.round(macroSum.carbs)}g</span>
        </div>
      </div>

    </div>
  );
}

// ── 手动新建食物 ──────────────────────────────────────────
function NewFoodForm({
  initialName,
  onCreate,
  onCancel,
}: {
  initialName: string;
  onCreate: (name: string, per100g: NutritionFacts, baseG: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [baseG, setBaseG] = useState('100');

  const num = (s: string): number | null => {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const canSave = name.trim().length > 0 && num(kcal) != null;

  return (
    <div className="card" style={{ marginTop: 14, borderColor: 'var(--line)' }}>
      <div className="title row">
        <span>手动新建食物</span>
        <span style={{ fontSize: 10, color: 'var(--mute)' }}>按每 100g 填写</span>
      </div>

      <div className="field" style={{ marginBottom: 9 }}>
        <span>名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 妈妈做的红烧肉" />
      </div>

      <div className="grid c3">
        <label className="field">
          <span>热量 kcal</span>
          <input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="必填" />
        </label>
        <label className="field">
          <span>蛋白 g</span>
          <input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </label>
      </div>
      <div className="grid c3" style={{ marginTop: 9 }}>
        <label className="field">
          <span>脂肪 g</span>
          <input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
        </label>
        <label className="field">
          <span>碳水 g</span>
          <input inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
        </label>
        <label className="field">
          <span>一份 g</span>
          <input inputMode="decimal" value={baseG} onChange={(e) => setBaseG(e.target.value)} />
        </label>
      </div>

      <div className="grid" style={{ marginTop: 11 }}>
        <button
          className="field"
          style={{ textAlign: 'center', fontSize: 13, color: 'var(--dim)' }}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          className="field"
          style={{
            textAlign: 'center', fontSize: 13, fontWeight: 700,
            color: canSave ? '#06210f' : '#3a4553',
            background: canSave ? 'linear-gradient(135deg,#4ade80,#22c55e)' : 'var(--card2)',
            borderColor: canSave ? 'transparent' : 'var(--line)',
          }}
          disabled={!canSave}
          onClick={() => {
            void onCreate(
              name.trim(),
              facts({
                kcal: num(kcal),
                protein: num(protein),
                fat: num(fat),
                carbs: num(carbs),
              }),
              num(baseG) ?? 100,
            );
          }}
        >
          创建并加入
        </button>
      </div>

      <div className="hint" style={{ textAlign: 'left', marginTop: 8 }}>
        纤维、钠等没填的项会记为「未知」，统计时按「—」处理，不会被当成 0。
      </div>
    </div>
  );
}
