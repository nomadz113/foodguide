import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recogniseMeal } from '../core/ai/client';
import { AiError, AI_ERROR_TEXT, type RawAiItem } from '../core/ai/types';
import { deobfuscate } from '../core/ai/keyStore';
import { allFoods, loadSettings, saveMeal } from '../core/db/repo';
import { makeItem, makeMeal, SLOT_LABELS } from '../core/meal/build';
import { facts, type NutrientKey, type NutritionFacts } from '../core/nutrition/types';
import { scaleFacts } from '../core/nutrition/calc';
import { matchAndFill, MATCH_WEAK } from '../core/food/match';
import { recordMiss } from '../core/food/miss';
import { fmtGrams, gramsStep, roundGrams } from '../core/meal/grams';
import {
  SHARE_LABELS, SHARE_ORDER, eatenGrams, loadShareDefault, nearestShareTier,
  saveShareDefault, shareFactor, wholeFromEaten, type ShareTier,
} from '../core/meal/share';
import { guessSlot } from '../core/date';
import type { Food, MealSlot, MealItem, Settings } from '../core/db/types';
import { useAppData } from '../store/AppData';
import { probeCamera, type CameraStatus } from '../native/probe';
import { IconChevron, IconExpand } from '../ui/icons';

/** 识别结果 → 可编辑草稿 */
interface CaptureItem {
  key: string;
  name: string;
  dish: string | null;
  per100g: NutritionFacts;
  baseG: number;
  grams: number;
  /** 烹调油/糖：份量档只按 0.5 阻尼跟随。拍照页没有档位按钮，但存进库后
   *  MealEdit 调档位要用它，否则一份油炸物切「小份」会平白少三成大卡 */
  damp?: number;
  confidence: number;
  /** 命中的食物库条目（用于补微量 + 留存匹配度） */
  foodId: string | null;
  matchScore: number | null;
  /** 命中的那条库食物的名字；null=没命中。弱命中时要靠它告诉用户「疑似认成了谁」 */
  matchedName: string | null;
  /** 微量补自哪条库食物；null 表示没匹配上 */
  microFrom: string | null;
  /** 实际由库填上的字段 */
  filled: NutrientKey[];
}

type Phase = 'idle' | 'recognising' | 'done' | 'error';

/** 油和糖不随菜量线性增长，减半跟随 */
const OIL_RE = /油|黄油|猪油|奶油|沙拉酱|糖/;

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * 识别结果 → 可编辑草稿。
 *
 * 没有「份量档」这个参数：AI 一律记照片里那一份的整量，用户要改就逐条加减，
 * 或者用「这餐你吃了多少」折算。两个整餐乘数（档位 × 比例）叠一起时，
 * 屏幕上没有任何地方能说清现在乘到哪一层 —— 一个数字只该有一个旋钮。
 */
function toDraft(item: RawAiItem, foods: Food[]): CaptureItem {
  const aiFacts = facts(item.per100g ?? {});
  // AI 只稳定给 6 项；剩下的维生素矿物质靠食物库补。只填空，不覆盖。
  const { per100g, match, filled } = matchAndFill(item.name ?? '', aiFacts, foods);
  // 克数交给 roundGrams：小量（<20g）必须留 1 位小数，取整会把调料类条目抹成整数
  const baseG = roundGrams(Number(item.baseG));
  const isOil = OIL_RE.test(item.name ?? '');
  return {
    key: `${item.name}-${Math.random().toString(36).slice(2, 7)}`,
    name: item.name ?? '未知食物',
    dish: item.dish ?? null,
    per100g,
    baseG,
    grams: baseG,
    damp: isOil ? 0.5 : undefined,
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.6,
    foodId: match?.food.id ?? null,
    matchScore: match?.score ?? null,
    matchedName: match?.food.name ?? null,
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
  /** 假设默认收起：它是「为什么这么算」的信任来源，不是每次都要读的内容 */
  const [assumeOpen, setAssumeOpen] = useState(false);
  /** 全屏看原图 */
  const [shotOpen, setShotOpen] = useState(false);
  /** 「重拍」的第一击只上膛，3 秒内再点才真的清空 —— 防止误触把 6 项识别结果扔了 */
  const [retakeArmed, setRetakeArmed] = useState(false);
  /**
   * 「这餐你吃了多少」。默认取上次的选择 —— 一家人的吃饭习惯是稳定的，
   * 不该每次重新点；识别结果里有明确合餐证据（整锅端上桌）时才用它盖掉。
   */
  const [share, setShare] = useState<ShareTier>(() => loadShareDefault());
  /** 原生端的相机自检结果；Web 端为 null */
  const [camStatus, setCamStatus] = useState<CameraStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 识别那一刻的库快照：保存时要拿它做反哺的自愈判断，不必再查一次 */
  const foodsRef = useRef<Food[]>([]);

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

  // 上膛状态 3 秒后自动撤销，不给用户留一个「看起来已按下一半」的按钮
  useEffect(() => {
    if (!retakeArmed) return;
    const timer = setTimeout(() => setRetakeArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [retakeArmed]);

  async function recognise(blob: Blob) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase('recognising');
    setLive([]);
    setDraft([]);
    setErr(null);
    setAssumeOpen(false);
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
      foodsRef.current = foods;
      setDraft(visible.map((it) => toDraft(it, foods)));
      // 模型只在有明显合餐证据时给 share（整锅端上桌）。给了就用它，没给沿用上次的档位。
      const hinted = nearestShareTier(result.share);
      if (hinted) setShare(hinted);
      setAssumptions(result.assumptions);
      setPhase('done');
    } catch (e) {
      // 用户主动中止不是错误：abort 会抛一个 AbortError，落到这里如果不单独处理，
      // 屏幕上会出现「网络错误」——他明明是自己按了停。
      if (ctrl.signal.aborted) {
        setPhase('idle');
        return;
      }
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

  function onAbort() {
    abortRef.current?.abort();
  }

  function onRetake() {
    if (!retakeArmed) {
      setRetakeArmed(true);
      return;
    }
    setRetakeArmed(false);
    setPhoto(null);
    setPreview(null);
    setLive([]);
    setDraft([]);
    setAssumptions([]);
    setErr(null);
    setPhase('idle');
  }

  const shareF = shareFactor(share);
  /** 整份 → 你吃了多少。展示、合计、入库全走它，避免"看着整份、存的是折算后"的不一致 */
  const eatenOf = (d: CaptureItem) => eatenGrams(d.grams, shareF);

  function bump(key: string, delta: number) {
    setDraft((prev) =>
      prev.map((d) =>
        d.key === key
          ? // 加减按「吃到的那份」走：屏幕上那个数字才会正好动 delta，
            // 直接改整份会让 1/3 折算后只动 1g，按三下等于没动
            { ...d, grams: wholeFromEaten(Math.max(0.5, eatenOf(d) + delta), shareF) }
          : d,
      ),
    );
  }

  function remove(key: string) {
    setDraft((prev) => prev.filter((d) => d.key !== key));
  }

  const totals = draft.reduce(
    (acc, d) => {
      const f = scaleFacts(d.per100g, eatenOf(d));
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
        makeItem({
          name: d.name,
          per100g: d.per100g,
          baseG: d.baseG,
          grams: eatenOf(d),
          parentDish: d.dish,
          foodId: d.foodId,
          // 条目身份来自照片识别，库只是补了微量；匹配度单独记录，别混进 matchType
          matchType: 'ai',
          matchScore: d.matchScore,
          fieldSource: buildFieldSource(d.per100g, d.filled),
          gramSource: 'ai',
          scaleDamp: d.damp,
          confidence: d.confidence,
        }),
      );
      const meal = makeMeal({ items, slot, source: 'photo', goalId: goal.id, date: today });
      await saveMeal(meal);

      // 库缺口（反哺）：记在保存之后、跳转之前，且不 await ——
      // 统计是为下一次服务，不能让用户为了它多等一拍。recordMiss 内部吞异常，
      // 万一失败也只是少一条统计，绝不能影响"这顿饭已经存好了"。
      for (const d of draft) {
        if (d.matchScore == null) {
          void recordMiss({ name: d.name, grams: eatenOf(d), per100g: d.per100g, foods: foodsRef.current });
        } else if (d.matchScore < MATCH_WEAK && d.filled.length === 0) {
          // 弱命中且一点微量都没补上 → 大概率认成了兄弟食材（鸡胸↔鸡腿）。
          // 只在「什么都没补到」时记：补到了说明这条匹配至少有用，误报会淹掉真信号。
          void recordMiss({
            name: d.name,
            grams: eatenOf(d),
            per100g: d.per100g,
            foods: foodsRef.current,
            near: { name: d.matchedName ?? '', score: d.matchScore, matched: true },
          });
        }
      }

      // replace：否则保存完按返回键会退回一个空态拍照页
      nav('/', { replace: true });
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
        {/* 保存常驻在底部（手指在那儿）。这里换成「重拍」——
            识别完想换一张图，原来只能取消退页再进来。 */}
        {phase === 'done' || phase === 'error' ? (
          <button className={retakeArmed ? 'warn' : ''} onClick={onRetake}>
            {retakeArmed ? '确认重拍' : '重拍'}
          </button>
        ) : null}
      </div>

      <div className="main">
        {phase === 'idle' && (
          <div className="capture-idle">
            <div className="empty" style={{ paddingTop: 0 }}>
              {lowKey ? (
                <>
                  还没填 API Key，识别功能不可用。
                  <br />
                  <button style={{ marginTop: 12, color: 'var(--green)', fontSize: 'var(--fs-body)' }} onClick={() => nav('/settings')}>
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
            {/* 上下堆叠而不是左右等宽：空态是分发入口，两个等宽按钮先让用户做一道选择题。
                这条路 95% 的情况是拍照，所以主按钮占满一整行。 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn-primary-wide" onClick={() => camRef.current?.click()}>
                拍照
              </button>
              <button className="btn-ghost-wide" style={{ marginTop: 0 }} onClick={() => fileRef.current?.click()}>
                从相册选
              </button>
            </div>
            {/* 系统里没有能调起的相机应用时，说明白，别让用户以为按钮坏了 */}
            {camStatus && !camStatus.canCapture && (
              <div className="hint" style={{ marginTop: 12, textAlign: 'left', lineHeight: 1.6 }}>
                这台机器的系统里没有能被调起的相机应用（Android {camStatus.sdk}，
                查到 {camStatus.cameraApps} 个）。点「拍照」只会打开相册，
                请用「从相册选」或直接拍好再选。
              </div>
            )}
            <div className="hint" style={{ marginTop: 16 }}>
              放个筷子、易拉罐做参照，份量会更准
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              不想拍照？
              <button style={{ color: 'var(--green)', marginLeft: 4, fontSize: 'var(--fs-caption)' }} onClick={() => nav('/add')}>
                直接搜食物记一餐
              </button>
            </div>
          </div>
        )}

        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />

        {/* 识别中给 300 大图：那一刻屏幕的唯一用途是让用户确认「我传的是这张」 */}
        {preview && phase !== 'done' && <img className="shot" src={preview} alt="这一餐" />}

        {phase === 'recognising' && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <b>{status}</b>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)' }}>已识别 {live.length} 项</span>
            </div>
            {live.map((it, i) => (
              <div className="krow" key={i} style={{ marginTop: 8 }}>
                <span>
                  {it.name}
                  {it.dish ? <span style={{ color: 'var(--mute)' }}> · {it.dish}</span> : null}
                </span>
                <b>
                  {fmtGrams(it.baseG ?? 0)}g ·{' '}
                  {Math.round(((it.per100g?.kcal ?? 0) * (it.baseG ?? 0)) / 100)} kcal
                </b>
              </div>
            ))}
            <div className="hint" style={{ marginTop: 12, opacity: 0.7 }}>
              逐项返回，不用等全部算完…
            </div>
          </div>
        )}

        {/* 中止：原来只能按顶部「取消」退页，而上一步的识别结果会一起丢掉。
            用户想的是「这张图不行」，不是「算了不记了」。 */}
        {phase === 'recognising' && (
          <button className="btn-ghost-wide" style={{ marginTop: 10 }} onClick={onAbort}>
            中止识别
          </button>
        )}

        {phase === 'error' && err && (
          <>
            <div className="alert error" style={{ marginTop: 12 }}>
              {AI_ERROR_TEXT[err.code as keyof typeof AI_ERROR_TEXT] ?? err.text}
              {err.code === 'no_key' && (
                <>
                  <br />
                  <button style={{ marginTop: 8, color: 'var(--green)', fontSize: 'var(--fs-caption)' }} onClick={() => nav('/settings')}>
                    去设置里填写
                  </button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className="btn-ghost-wide" style={{ marginTop: 0, flex: 1 }} onClick={() => photo && void recognise(photo)}>
                重试
              </button>
              <button className="btn-ghost-wide" style={{ marginTop: 0, flex: 1 }} onClick={onRetake}>
                重新拍
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            {/* 识别完成后照片只剩「对照」作用，88px 就够，点开才是原图。
                这 212px 是整页最大的一笔腾挪 —— 省下来正好给条目列表。 */}
            {preview && (
              <button className="thumb" onClick={() => setShotOpen(true)} aria-label="查看原图">
                <img src={preview} alt="这一餐" />
                <span className="zoom"><IconExpand size={14} /></span>
              </button>
            )}

            <div className="seg" style={{ marginTop: 12 }}>
              {SLOTS.map((s) => (
                <button key={s} className={slot === s ? 'on' : ''} onClick={() => setSlot(s)}>
                  {SLOT_LABELS[s]}
                </button>
              ))}
            </div>

            {/* 只剩「吃了」这一个乘数。
                「咸淡」那一档已删除：它按 0.6/1/1.6 缩放盐的克数，而盐本身就是模型
                看图猜的，两层估算相乘之后这个数字已经不可解释 —— 用户调它只是在
                调一个自己也不知道准不准的数。 */}
            <div className="attr-card">
              <div className="attr-row">
                <span className="attr-lbl">吃了</span>
                <div className="tiers3">
                  {SHARE_ORDER.map((t) => (
                    <button
                      key={t}
                      className={share === t ? 'on' : ''}
                      onClick={() => {
                        setShare(t);
                        saveShareDefault(t);
                      }}
                    >
                      {SHARE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="capture-list">
              {draft.map((d) => {
                const g = eatenOf(d);
                const f = scaleFacts(d.per100g, g);
                const step = gramsStep(g);
                return (
                  <div className="selitem" key={d.key}>
                    <div className="top">
                      <b>
                        {d.name}
                        {d.dish && <span style={{ color: 'var(--mute)', fontSize: 'var(--fs-caption)' }}> · {d.dish}</span>}
                      </b>
                      <span className="kc">{Math.round(f.kcal ?? 0)} kcal</span>
                      <button className="rm" onClick={() => remove(d.key)}>×</button>
                    </div>
                    <div className="ctl">
                      <div className="stepper">
                        <button onClick={() => bump(d.key, -step)}>−</button>
                        <b>{fmtGrams(g)}g</b>
                        <button onClick={() => bump(d.key, step)}>+</button>
                      </div>
                      {/* 琥珀不红：红色在本项目里只表示上限型指标超限。
                          「AI 没把握」和「你超标了」是两件事，不该同色。 */}
                      {d.confidence < 0.7 && <span className="pill warn">把握不大</span>}
                    </div>
                    {d.microFrom && d.filled.length >= 3 && (
                      <div className="hint" style={{ marginTop: 6, fontSize: 'var(--fs-caption)', textAlign: 'left' }}>
                        {d.filled.length} 项维生素矿物质参考「{d.microFrom}」
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {assumptions.length > 0 && (
              <div className={`fold ${assumeOpen ? 'open' : ''}`}>
                <button onClick={() => setAssumeOpen((v) => !v)} aria-expanded={assumeOpen}>
                  <span>识别依据 · {assumptions.length} 条假设</span>
                  <span className="chev"><IconChevron size={16} /></span>
                </button>
                <div className="body" hidden={!assumeOpen}>
                  {assumptions.map((a, i) => (
                    <div key={i} className="hint">· {a}</div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 保存从顶部挪到这里：用户在页面上做了十几次加减克数，手指一直在屏幕下半。 */}
      {phase === 'done' && (
        <div className="totalbar tb-capture">
          <div className="tb-left">
            <div className="tb-l1">
              <b>{Math.round(totals.kcal)}</b>
              <span>kcal</span>
            </div>
            <div className="tb-l2">
              蛋白 {Math.round(totals.protein)} · 脂肪 {Math.round(totals.fat)} · 碳水 {Math.round(totals.carbs)}
            </div>
          </div>
          <button
            className="btn-save"
            disabled={draft.length === 0 || saving}
            onClick={() => void save()}
          >
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      )}

      {shotOpen && preview && (
        <div className="shotview" role="dialog" aria-label="原图" onClick={() => setShotOpen(false)}>
          <img src={preview} alt="这一餐" />
        </div>
      )}
    </>
  );
}
