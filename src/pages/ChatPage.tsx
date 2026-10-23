import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseIntent } from '../core/ai/client';
import { AiError } from '../core/ai/types';
import { deobfuscate } from '../core/ai/keyStore';
import {
  addChat, allFoods, clearChat, customFoods, mealsOfDay, recentChat, rejectPendingChats, setChatStatus,
} from '../core/db/repo';
import { findMatch } from '../core/food/match';
import {
  resolveIntent, sourceLabel, withItemGrams, withServingGrams, withServingValue,
  type FoodCard, type MealCard, type ResolvedCard,
} from '../core/intent/resolve';
import { applyCard } from '../core/intent/apply';
import { SLOT_LABELS } from '../core/meal/build';
import { formatDayLabel } from '../core/date';
import { NUTRIENT_LABELS, isKnown, type NutrientKey } from '../core/nutrition/types';
import type { ChatMessage } from '../core/db/types';
import { useAppData } from '../store/AppData';
import { useKeyboardInset } from '../ui/keyboard';
import { NumInput } from '../ui/NumInput';

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

const EXAMPLES = [
  '记住，我妈做的红烧肉，一碗大概 320 大卡，蛋白质 18g、脂肪 22g、碳水 15g',
  '今天中午吃了番茄炒蛋和一碗米饭',
  '红烧肉多少卡？',
];

/** 编辑中的数字输入：空串 = 未知，不是 0（删得干净，见 ui/NumInput） */
function NumField({
  label, value, unit, onChange,
}: {
  label: string;
  value: number | null;
  unit?: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="numfield">
      <span>{label}</span>
      <div>
        <NumInput value={value} onValue={onChange} placeholder="—" />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}

export function ChatPage() {
  const nav = useNavigate();
  const { settings, today, goal } = useAppData();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 正在编辑的卡片（只存本地，不落库） */
  const [editing, setEditing] = useState<{ id: string; card: FoodCard | MealCard } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 键盘高度。壳收缩后最后一条消息会掉到可视区外，必须跟着滚一次 */
  const kb = useKeyboardInset();

  useEffect(() => {
    void recentChat(60).then(setMsgs);
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs.length, busy]);

  useEffect(() => {
    // 键盘刚升起时不要用 smooth：动画和滚动抢时间，常常滚不到位
    if (kb > 0) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [kb]);

  const cfg = useMemo(
    () => ({
      mode: settings.mode,
      apiKey: deobfuscate(settings.apiKeyCipher),
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: settings.textModel || 'qwen-plus',
    }),
    [settings.mode, settings.apiKeyCipher, settings.textModel],
  );

  const push = useCallback(async (m: Omit<ChatMessage, 'id' | 'createdAt'>) => {
    const row = await addChat(m);
    setMsgs((prev) => [...prev, row]);
    return row;
  }, []);

  /** 本地数据能直接答的问题就不麻烦模型 */
  async function answerLocally(card: ResolvedCard): Promise<string | null> {
    if (card.kind !== 'text') return null;
    if (card.query === 'stats') {
      const meals = await mealsOfDay(today);
      if (meals.length === 0) return '今天还没记过东西。';
      const kcal = meals.reduce((a, m) => a + (m.totals.kcal ?? 0), 0);
      const protein = meals.reduce((a, m) => a + (m.totals.protein ?? 0), 0);
      const target = goal.kcal;
      const left = target != null ? target - kcal : null;
      const tail = left == null ? '。' : left >= 0 ? `，还可以吃 ${r0(left)} kcal。` : `，超出 ${r0(-left)} kcal。`;
      return `${formatDayLabel(today)} ${meals.length} 餐，共 ${r0(kcal)} kcal（蛋白 ${r0(protein)}g）${tail}`;
    }
    if (card.query === 'food' && card.queryName) {
      const foods = await allFoods();
      const hit = findMatch(card.queryName, foods);
      if (!hit) return `食物库里没有「${card.queryName}」，你可以说「记住，……多少卡」自己加一条。`;
      const p = hit.food.per100g;
      const serving = hit.food.serving
        ? `，${hit.food.serving.quantity}${hit.food.serving.unit}约 ${hit.food.serving.grams}g`
        : '';
      return `${hit.food.name}：${r0(p.kcal ?? 0)} kcal/100g（蛋白 ${r1(p.protein ?? 0)}g、脂肪 ${r1(p.fat ?? 0)}g、碳水 ${r1(p.carbs ?? 0)}g）${serving}。`;
    }
    return null;
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput('');
    setErr(null);
    setBusy(true);
    setEditing(null);

    try {
      await push({ date: today, role: 'user', kind: 'text', text: t, intent: null, card: null, status: null, relatedMealId: null, relatedFoodId: null });
      // 旧卡作废：用户已经在说下一件事了，不该再等他点上一张
      const rejected = await rejectPendingChats();
      if (rejected > 0) setMsgs((prev) => prev.map((m) => (m.status === 'pending' ? { ...m, status: 'rejected' } : m)));

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const [foods, customs] = await Promise.all([allFoods(), customFoods()]);
      const { intent } = await parseIntent(t, {
        config: cfg,
        signal: ctrl.signal,
        today,
        knownFoods: customs.map((f) => f.name),
      });

      const card = resolveIntent(intent, { foods, today });

      // 回执：卡片类绝不能用模型那句 reply —— 它常常写"已经记好了"，
      // 而这时候还没落库，等于先撒谎再让用户点确认。卡片类只给一句中性提示。
      const prompt = card.kind === 'log_meal'
        ? '整理好了，确认下份量？'
        : card.kind === 'delete_food'
          ? '确认要删掉这条吗？'
          : card.kind === 'text'
            ? ((await answerLocally(card)) ?? card.reply)
            : '我整理成一条食物，确认一下？';
      await push({
        date: today, role: 'assistant', kind: 'text', text: prompt,
        intent: null, card: null, status: null, relatedMealId: null, relatedFoodId: null,
      });

      if (card.kind !== 'text') {
        await push({
          date: today, role: 'assistant', kind: 'intent_card', text: '',
          intent, card, status: 'pending', relatedMealId: null, relatedFoodId: null,
        });
      }
    } catch (e) {
      const msg = e instanceof AiError ? e.message : (e instanceof Error ? e.message : '出错了');
      setErr(msg === 'aborted' ? '已取消' : msg);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string, card: ResolvedCard) {
    setBusy(true);
    try {
      const res = await applyCard(card);
      await setChatStatus(id, res.ok ? 'applied' : 'rejected');
      setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, status: res.ok ? 'applied' : 'rejected' } : m)));
      await push({
        date: today, role: 'assistant', kind: 'result', text: res.message,
        intent: null, card: null, status: null,
        relatedMealId: res.relatedMealId, relatedFoodId: res.relatedFoodId,
      });
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    await setChatStatus(id, 'rejected');
    setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'rejected' } : m)));
    setEditing(null);
  }

  async function clearAll() {
    await clearChat();
    setMsgs([]);
    setEditing(null);
  }

  return (
    <>
      <div className="hdr">
        <div>
          <h1 style={{ fontSize: 20 }}>小助手</h1>
          <div className="sub">说一句话就能记账 · 也能定义食物</div>
        </div>
        {msgs.length > 0 && (
          <button className="pill" onClick={() => void clearAll()}>清空</button>
        )}
      </div>

      <div className="main" style={{ paddingBottom: 8 }}>
        {msgs.length === 0 && (
          <div className="chat-empty">
            <div className="ce-title">你说话，我记账</div>
            <div className="ce-sub">
              「记住，我妈做的红烧肉一碗 320 大卡」<br />
              说一次，以后所有地方都优先用你的数据。
            </div>
            <div className="ce-ex">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => void send(e)}>{e}</button>
              ))}
            </div>
          </div>
        )}

        <div className="bubbles">
          {msgs.map((m) => {
            if (m.kind === 'text') {
              return (
                <div key={m.id} className={`msg ${m.role === 'user' ? 'me' : 'ai'}`}>
                  <div className="bub">{m.text}</div>
                </div>
              );
            }
            if (m.kind === 'result') {
              return (
                <div key={m.id} className="msg ai">
                  <div className="bub result">{m.text}</div>
                </div>
              );
            }
            const card = m.card as ResolvedCard | null;
            if (!card || card.kind === 'text') return null;
            return (
              <CardView
                key={m.id}
                id={m.id}
                card={card}
                status={m.status}
                editing={editing?.id === m.id ? editing.card : null}
                onEdit={(c) => setEditing({ id: m.id, card: c })}
                onCancelEdit={() => setEditing(null)}
                onConfirm={() => void confirm(m.id, editing?.id === m.id ? editing.card : card)}
                onReject={() => void reject(m.id)}
                busy={busy}
              />
            );
          })}

          {busy && (
            <div className="msg ai">
              <div className="bub typing"><i /><i /><i /></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {err && <div className="alert error" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <div className="composer">
        <div className="chips">
          {['记住一道菜', '今天中午吃了…', '今天吃了多少'].map((c) => (
            <button key={c} className="chip" onClick={() => setInput(
              c === '记住一道菜' ? '记住，' : c === '今天中午吃了…' ? '今天中午吃了' : '今天吃了多少？',
            )}>{c}</button>
          ))}
        </div>
        <div className="inputrow">
          <textarea
            rows={1}
            value={input}
            placeholder="说一句话…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button
            className="send"
            disabled={busy || !input.trim()}
            onClick={() => void send(input)}
          >
            发送
          </button>
        </div>
        {settings.mode === 'direct' && !settings.apiKeyCipher && (
          <button className="hint" style={{ color: 'var(--green)', marginTop: 6 }} onClick={() => nav('/settings')}>
            还没填 API Key，去设置里填写
          </button>
        )}
      </div>
    </>
  );
}

// ── 卡片 ───────────────────────────────────────────────

function CardView({
  id, card, status, editing, onEdit, onCancelEdit, onConfirm, onReject, busy,
}: {
  id: string;
  card: FoodCard | MealCard;
  status: ChatMessage['status'];
  editing: FoodCard | MealCard | null;
  onEdit: (c: FoodCard | MealCard) => void;
  onCancelEdit: () => void;
  onConfirm: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const live = editing ?? card;
  const done = status === 'applied' || status === 'rejected';

  if (done) {
    return (
      <div className={`intentcard done ${status}`}>
        <span>
          {status === 'applied' ? '已保存' : '已取消'} ·{' '}
          {card.kind === 'log_meal' ? `${SLOT_LABELS[card.slot]} ${r0(card.kcal)} kcal` : card.name}
        </span>
      </div>
    );
  }

  if (live.kind === 'log_meal') {
    const c = live as MealCard;
    return (
      <div className="intentcard" data-card={id}>
        <div className="ic-head">
          <div>
            <div className="ic-title">{formatDayLabel(c.date)} · {SLOT_LABELS[c.slot]}</div>
            <div className="ic-sub">{c.items.length} 项 · 共 {r0(c.kcal)} kcal</div>
          </div>
          <span className={`chip ${c.confidence >= 0.8 ? 'g' : 'y'}`}>
            {c.confidence >= 0.8 ? '记一餐' : '把握一般'}
          </span>
        </div>

        <div className="ic-items">
          {c.items.map((it, i) => (
            <div className="ic-item" key={`${it.name}-${i}`}>
              <div className="ic-item-l">
                <b>{it.name}</b>
                <span className={`src ${it.source}`}>{sourceLabel(it.source)}</span>
              </div>
              {editing ? (
                <div className="mini-num">
                  {/* 删空时只清空输入框，不改卡片里的份量（0 克没有意义） */}
                  <NumInput
                    value={it.grams}
                    onValue={(g) => {
                      if (g != null && g > 0) onEdit(withItemGrams(c, i, g));
                    }}
                  />
                  <em>g</em>
                  <span>{r0(it.kcal)} kcal</span>
                </div>
              ) : (
                <span className="ic-item-r">{it.grams}g · {r0(it.kcal)} kcal</span>
              )}
            </div>
          ))}
        </div>

        <div className="ic-grid2">
          <span>蛋白 <b>{r0(c.protein)}g</b></span>
          <span>脂肪 <b>{r0(c.fat)}g</b></span>
          <span>碳水 <b>{r0(c.carbs)}g</b></span>
        </div>

        <Notes assumptions={c.assumptions} caveats={c.caveats} missing={c.missing} />

        <div className="ic-btns">
          {editing ? (
            <>
              <button className="btn ghost" onClick={onCancelEdit}>改回</button>
              <button className="btn primary" disabled={busy} onClick={onConfirm}>就按这些</button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={onReject} disabled={busy}>取消</button>
              <button className="btn ghost" onClick={() => onEdit(c)} disabled={busy}>改份量</button>
              <button className="btn primary" onClick={onConfirm} disabled={busy}>记入今天</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const c = live as FoodCard;
  const editable = editing != null;
  const isDelete = c.kind === 'delete_food';

  return (
    <div className="intentcard" data-card={id}>
      <div className="ic-head">
        <div>
          <div className="ic-title">{c.name}</div>
          <div className="ic-sub">
            {isDelete ? '删除自定义食物'
              : c.basis === 'per_serving'
                ? `自定义食物 · 1${c.serving?.unit ?? '份'} ≈ ${c.serving?.grams ?? '?'}g`
                : '自定义食物 · 按每 100g'}
            {c.aliases.length > 0 && ` · 别名：${c.aliases.slice(0, 3).join(' / ')}`}
          </div>
        </div>
        <span className={`chip ${isDelete ? 'r' : 'g'}`}>{isDelete ? '删除' : '你的库'}</span>
      </div>

      {isDelete ? (
        <div className="ic-note">删掉后，历史记录不受影响；将来的识别不再优先用它。</div>
      ) : editable ? (
        <>
          <div className="edit-grid">
            <NumField
              label={c.basis === 'per_serving' ? '一份多少克' : '每百克'}
              unit="g"
              value={c.serving?.grams ?? 100}
              onChange={(v) => v && v > 0 && onEdit(withServingGrams(c, v))}
            />
            {(['kcal', 'protein', 'fat', 'carbs'] as NutrientKey[]).map((k) => (
              <NumField
                key={k}
                label={NUTRIENT_LABELS[k]}
                unit={k === 'kcal' ? 'kcal' : 'g'}
                value={isKnown(c.servingValues[k]) ? c.servingValues[k] : null}
                onChange={(v) => onEdit(withServingValue(c, k, v))}
              />
            ))}
          </div>
          <div className="ic-note">
            {c.basis === 'per_serving'
              ? `按 1${c.serving?.unit ?? '份'} = ${c.serving?.grams ?? 0}g 换算，每百克 ${r0(c.per100g.kcal ?? 0)} kcal`
              : `每 100g ${r0(c.per100g.kcal ?? 0)} kcal`}
          </div>
        </>
      ) : (
        <div className="ic-grid">
          <div className="ic-cell"><span>基准份量</span><b>{c.serving ? `${c.serving.quantity}${c.serving.unit} ≈ ${c.serving.grams}g` : '每 100g'}</b></div>
          <div className="ic-cell"><span>热量</span><b>{r0(c.servingKcal ?? c.per100g.kcal ?? 0)} kcal</b></div>
          <div className="ic-cell"><span>蛋白质</span><b>{isKnown(c.servingValues.protein) ? `${r1(c.servingValues.protein)} g` : '未填'}</b></div>
          <div className="ic-cell"><span>脂肪</span><b>{isKnown(c.servingValues.fat) ? `${r1(c.servingValues.fat)} g` : '未填'}</b></div>
          <div className="ic-cell"><span>碳水</span><b>{isKnown(c.servingValues.carbs) ? `${r1(c.servingValues.carbs)} g` : '未填'}</b></div>
          <div className="ic-cell"><span>每百克</span><b>{r0(c.per100g.kcal ?? 0)} kcal</b></div>
        </div>
      )}

      {!isDelete && <Notes assumptions={c.assumptions} caveats={c.caveats} missing={c.missing} />}

      <div className="ic-btns">
        {editable ? (
          <>
            <button className="btn ghost" onClick={onCancelEdit}>改回</button>
            <button className="btn primary" disabled={busy} onClick={onConfirm}>就按这些</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={onReject} disabled={busy}>取消</button>
            {!isDelete && (
              <button className="btn ghost" onClick={() => onEdit(c)} disabled={busy}>修改</button>
            )}
            <button className={`btn ${isDelete ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>
              {isDelete ? '确认删除' : '保存到食物库'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Notes({
  assumptions, caveats, missing,
}: { assumptions: string[]; caveats: string[]; missing: string[] }) {
  if (assumptions.length === 0 && caveats.length === 0 && missing.length === 0) return null;
  return (
    <div className="ic-notes">
      {caveats.map((t, i) => <div key={`c${i}`} className="warn">· {t}</div>)}
      {assumptions.map((t, i) => <div key={`a${i}`}>· {t}</div>)}
      {missing.length > 0 && (
        <div className="miss">
          {`· ${missing.slice(0, 6).join('、')}${missing.length > 6 ? ` 共 ${missing.length} 项` : ''}没有数据，保持「未知」而不是 0`}
        </div>
      )}
    </div>
  );
}
