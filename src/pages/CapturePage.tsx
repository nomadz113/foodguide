import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recogniseMeal } from '../core/ai/client';
import { AiError, AI_ERROR_TEXT, type RawAiItem } from '../core/ai/types';
import { deobfuscate } from '../core/ai/keyStore';
import { allFoods, loadSettings, saveMeal } from '../core/db/repo';
import { makeItem, makeMeal, SLOT_LABELS } from '../core/meal/build';
import { facts, type NutrientKey, type NutritionFacts } from '../core/nutrition/types';
import { scaleFacts } from '../core/nutrition/calc';
import { matchAndFill } from '../core/food/match';
import { tierGrams } from '../core/portion/tier';
import { guessSlot } from '../core/date';
import type { Food, MealSlot, MealItem, PortionTier, Settings } from '../core/db/types';
import { useAppData } from '../store/AppData';
import { probeCamera, type CameraStatus } from '../native/probe';

/** 识别结果 → 可编辑草稿 */
interface CaptureItem {
  key: string;
  name: string;
  dish: string | null;
  per100g: NutritionFacts;
  baseG: number;
  grams: number;
  tier: PortionTier;
  /** 用户点过档位才算学习样本 */
  tierConfirmed: boolean;
  /** 烹调油：档位只按 0.5 阻尼缩放 */
  damp?: number;
  confidence: number;
  /** 命中的食物库条目（用于补微量 + 留存匹配度） */
  foodId: string | null;
  matchScore: number | null;
  /** 微量补自哪条库食物；null 表示没匹配上 */
  microFrom: string | null;
  /** 实际由库填上的字段 */
  filled: NutrientKey[];
}

type Phase = 'idle' | 'recognising' | 'done' | 'error';

/** 油和糖不随菜量线性增长，减半跟随 */
const OIL_RE = /油|黄油|猪油|奶油|沙拉酱|糖/;

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function toDraft(item: RawAiItem, tier: PortionTier, foods: Food[]): CaptureItem {
  const aiFacts = facts(item.per100g ?? {});
  // AI 只稳定给 6 项；剩下的维生素矿物质靠食物库补。只填空，不覆盖。
  const { per100g, match, filled } = matchAndFill(item.name ?? '', aiFacts, foods);
  const baseG = Math.max(1, Math.round(Number(item.baseG) || 0));
  const isOil = OIL_RE.test(item.name ?? '');
  return {
    key: `${item.name}-${Math.random().toString(36).slice(2, 7)}`,
    name: item.name ?? '未知食物',
    dish: item.dish ?? null,
    per100g,
    baseG,
    grams: isOil ? Math.round(baseG) : tierGrams(baseG, tier, 1),
    tier,
    tierConfirmed: false,
    damp: isOil ? 0.5 : undefined,
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.6,
    foodId: match?.food.id ?? null,
    matchScore: match?.score ?? null,
    microFrom: filled.length > 0 ? (match?.food.name ?? null) : null,
    filled,
  };
}

/** 逐字段来源：没被库填过的已知字段都算 AI 的 */
function buildFieldSource(per100g: NutritionFacts, filled: NutrientKey[]): MealItem['fieldSource'] {
  const out: MealItem['fieldSource'] = {};
  const lib = new Set(filled);
  for (const k of Object.keys(per100g) as NutrientKey[]) {
    if (per100g[k] == null) continue;
    out[k] = lib.has(k) ? 'library' : 'ai';
  }
  return out;
}

export function CapturePage() {
  const nav = useNavigate();
  const { goal, today } = useAppData();
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [live, setLive] = useState<RawAiItem[]>([]);
  const [status, setStatus] = useState('准备中');
  const [draft, setDraft] = useState<CaptureItem[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [slot, setSlot] = useState<MealSlot>(guessSlot());
  const [err, setErr] = useState<{ text: string; code: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** 当前整餐档位；用户手动改克数后置空（此时档位已不代表实际份量） */
  const [globalTier, setGlobalTier] = useState<PortionTier | null>('medium');
  /** 原生端的相机自检结果；Web 端为 null */
  const [camStatus, setCamStatus] = useState<CameraStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    // 原生包要确认系统里真有能被调起的相机应用：Android 11 的包可见性会让
    // Capacitor 解析不到相机，然后静默回退成相册（用户只看到「点拍照没反应/只弹相册」）。
    void probeCamera().then(setCamStatus);
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function recognise(blob: Blob) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase('recognising');
    setLive([]);
    setDraft([]);
    setErr(null);
    setStatus('正在准备…');

    const cfg = {
      mode: settings?.mode ?? 'direct',
      apiKey: deobfuscate(settings?.apiKeyCipher ?? null),
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: settings?.visionModel || 'qwen3-vl-plus',
    };

    try {
      const { draft: result } = await recogniseMeal(blob, {
        config: cfg,
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.type === 'status') setStatus(e.text);
          else if (e.type === 'item') setLive((prev) => [...prev, e.item]);
        },
      });
      // 「水」只用来表达汤汁体积，0 热量且占一行，界面上不展示
      const visible = result.items.filter((it) => !/^(水|清水|白水|白开水|开水)$/.test(it.name ?? ''));
      // 匹配要在识别完成后再取一次库，保证用户自建的条目（P3）也在候选里
      const foods = await allFoods();
      setDraft(visible.map((it) => toDraft(it, 'medium', foods)));
      setGlobalTier('medium');
      setAssumptions(result.assumptions);
      setPhase('done');
    } catch (e) {
      const code = e instanceof AiError ? e.code : 'network';
      setErr({ text: e instanceof AiError ? e.message : '识别失败', code });
      setPhase('error');
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPhoto(f);
    void recognise(f);
  }

  function setAllTier(t: PortionTier) {
    setGlobalTier(t);
    setDraft((prev) =>
      prev.map((d) => ({
        ...d,
        tier: t,
        tierConfirmed: true,
        // 以 baseG 为锚重算，绝不从当前 grams 累乘（连点三个档位会累积漂移）。
        // 油/糖带 damp=0.5，倍率减半跟随，否则大份会凭空空出上百大卡。
        grams: tierGrams(d.baseG, t, d.damp ?? 1),
      })),
    );
  }

  function bump(key: string, delta: number) {
    // 手动改过克数就不再声称是某个档位
    setGlobalTier(null);
    setDraft((prev) =>
      prev.map((d) => (d.key === key ? { ...d, grams: Math.max(1, d.grams + delta) } : d)),
    );
  }

  function remove(key: string) {
    setDraft((prev) => prev.filter((d) => d.key !== key));
  }

  const totals = draft.reduce(
    (acc, d) => {
      const f = scaleFacts(d.per100g, d.grams);
      return {
        kcal: acc.kcal + (f.kcal ?? 0),
        protein: acc.protein + (f.protein ?? 0),
        fat: acc.fat + (f.fat ?? 0),
        carbs: acc.carbs + (f.carbs ?? 0),
      };
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );

  async function save() {
    if (draft.length === 0) return;
    setSaving(true);
    try {
      const items = draft.map((d) =>
        makeItem(
          {
            name: d.name,
            per100g: d.per100g,
            baseG: d.baseG,
            grams: d.grams,
            parentDish: d.dish,
            foodId: d.foodId,
            // 条目身份来自照片识别，库只是补了微量；匹配度单独记录，别混进 matchType
            matchType: 'ai',
            matchScore: d.matchScore,
            fieldSource: buildFieldSource(d.per100g, d.filled),
            gramSource: 'ai',
            scaleDamp: d.damp,
            confidence: d.confidence,
          },
          d.tier,
        ),
      );
      const meal = makeMeal({ items, slot, source: 'photo', goalId: goal.id, date: today });
      await saveMeal(meal);
      nav('/');
    } finally {
      setSaving(false);
    }
  }

  const lowKey = settings && settings.mode === 'direct' && !settings.apiKeyCipher;

  return (
    <>
      <div className="sheetbar">
        <button onClick={() => nav('/')}>取消</button>
        <h2>拍照识别</h2>
        <button
          className="primary"
          disabled={phase !== 'done' || draft.length === 0 || saving}
          onClick={() => void save()}
        >
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      <div className="main">
        {phase === 'idle' && (
          <>
            <div className="empty" style={{ paddingTop: 40 }}>
              {lowKey ? (
                <>
                  还没填 API Key，识别功能不可用。
                  <br />
                  <button style={{ marginTop: 12, color: 'var(--green)' }} onClick={() => nav('/settings')}>
                    去设置里填写
                  </button>
                </>
              ) : (
                <>
                  拍一张这顿饭的照片，
                  <br />
                  我帮你算出吃了多少。
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="pill ok" style={{ flex: 1, height: 46 }} onClick={() => camRef.current?.click()}>
                拍照
              </button>
              <button className="pill" style={{ flex: 1, height: 46 }} onClick={() => fileRef.current?.click()}>
                从相册选
              </button>
            </div>
            {/* 系统里没有能调起的相机应用时，说明白，别让用户以为按钮坏了 */}
            {camStatus && !camStatus.canCapture && (
              <div className="hint" style={{ marginTop: 10, textAlign: 'left', lineHeight: 1.55 }}>
                这台机器的系统里没有能被调起的相机应用（Android {camStatus.sdk}，
                查到 {camStatus.cameraApps} 个）。点「拍照」只会打开相册，
                请用「从相册选」或直接拍好再选。
              </div>
            )}
            <div className="hint" style={{ marginTop: 14, textAlign: 'center' }}>
              放个筷子、易拉罐做参照，份量会更准
            </div>
            <div className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
              不想拍照？
              <button style={{ color: 'var(--green)', marginLeft: 2 }} onClick={() => nav('/add')}>
                直接搜食物记一餐
              </button>
            </div>
          </>
        )}

        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />

        {preview && <img className="shot" src={preview} alt="这一餐" />}

        {phase === 'recognising' && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <b>{status}</b>
              <span style={{ fontSize: 11, color: 'var(--mute)' }}>已识别 {live.length} 项</span>
            </div>
            {live.map((it, i) => (
              <div className="krow" key={i} style={{ marginTop: 8 }}>
                <span>
                  {it.name}
                  {it.dish ? <span style={{ color: 'var(--mute)' }}> · {it.dish}</span> : null}
                </span>
                <b>
                  {Math.round(it.baseG ?? 0)}g ·{' '}
                  {Math.round(((it.per100g?.kcal ?? 0) * (it.baseG ?? 0)) / 100)} kcal
                </b>
              </div>
            ))}
            <div className="hint" style={{ marginTop: 12, opacity: 0.7 }}>
              继续识别中，逐项返回不用等全部算完…
            </div>
          </div>
        )}

        {phase === 'error' && err && (
          <>
            <div className="alert error" style={{ marginTop: 12 }}>
              {AI_ERROR_TEXT[err.code as keyof typeof AI_ERROR_TEXT] ?? err.text}
              {err.code === 'no_key' && (
                <>
                  <br />
                  <button style={{ marginTop: 8, color: 'var(--green)' }} onClick={() => nav('/settings')}>
                    去设置里填写
                  </button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className="pill" style={{ flex: 1 }} onClick={() => photo && void recognise(photo)}>
                重试
              </button>
              <button
                className="pill"
                style={{ flex: 1 }}
                onClick={() => {
                  setPhoto(null);
                  setPreview(null);
                  setPhase('idle');
                  setErr(null);
                }}
              >
                重新拍
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="seg" style={{ marginTop: 12 }}>
              {SLOTS.map((s) => (
                <button key={s} className={slot === s ? 'on' : ''} onClick={() => setSlot(s)}>
                  {SLOT_LABELS[s]}
                </button>
              ))}
            </div>

            <div className="row" style={{ marginTop: 14, padding: '0 2px' }}>
              <b style={{ fontSize: 12 }}>这盘大概多少？</b>
              <span style={{ fontSize: 10.5, color: 'var(--mute)' }}>点档位整餐联动</span>
            </div>
            <div className="tiers3" style={{ marginTop: 8 }}>
              {(['small', 'medium', 'large'] as PortionTier[]).map((t) => (
                <button key={t} className={globalTier === t ? 'on' : ''} onClick={() => setAllTier(t)}>
                  {t === 'small' ? '小份 −30%' : t === 'medium' ? '中份' : '大份 +30%'}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              {draft.map((d) => {
                const f = scaleFacts(d.per100g, d.grams);
                const step = d.baseG <= 60 ? 5 : 10;
                return (
                  <div className="selitem" key={d.key} style={{ marginTop: 7 }}>
                    <div className="top">
                      <b>
                        {d.name}
                        {d.dish && <span style={{ color: 'var(--mute)', fontSize: 10.5 }}> · {d.dish}</span>}
                      </b>
                      <span className="kc">{Math.round(f.kcal ?? 0)} kcal</span>
                      <button className="rm" onClick={() => remove(d.key)}>×</button>
                    </div>
                    <div className="ctl">
                      <div className="stepper">
                        <button onClick={() => bump(d.key, -step)}>−</button>
                        <b>{d.grams}g</b>
                        <button onClick={() => bump(d.key, step)}>+</button>
                      </div>
                      {d.confidence < 0.7 && <span className="pill bad">把握不大</span>}
                    </div>
                    {d.microFrom && d.filled.length >= 3 && (
                      <div className="hint" style={{ marginTop: 5, fontSize: 10, opacity: 0.62 }}>
                        {d.filled.length} 项维生素矿物质参考「{d.microFrom}」
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {assumptions.length > 0 && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="row">
                  <span style={{ fontSize: 11, color: 'var(--mute)' }}>AI 的假设</span>
                </div>
                {assumptions.map((a, i) => (
                  <div key={i} className="hint" style={{ marginTop: 6, lineHeight: 1.5 }}>
                    · {a}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {phase === 'done' && (
        <div className="totalbar">
          <div className="big">
            <b>{Math.round(totals.kcal)}</b>
            <span>kcal</span>
          </div>
          <div className="macro3">
            <div>
              <span>蛋白</span>
              <b>{Math.round(totals.protein)}g</b>
            </div>
            <div>
              <span>脂肪</span>
              <b>{Math.round(totals.fat)}g</b>
            </div>
            <div>
              <span>碳水</span>
              <b>{Math.round(totals.carbs)}g</b>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
