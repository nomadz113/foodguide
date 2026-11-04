/**
 * 库缺口清单 —— 让食物库按用户真实吃的东西长大。
 *
 * 这个页面只做三件事：把「AI 认出来但库里没有」的名字摆出来、给一个成本最低的
 * 补法（加别名 < 入册 < 什么都不做）、以及让用户能拒绝。
 *
 * 刻意不做的：
 * - **不自动入册**。补进来的条目会以 custom（priority 100）身份参与未来所有匹配，
 *   一条错的自定义食物比十条缺失更糟。必须人点一次。
 * - **不为分类打 AI**。分类只是展示标签，关键词表的准确率在粗分类上够用，
 *   为它多一次网络调用（要钱、可能失败）不值。
 * - **不展示「微矿已补」之类的暗示**。从缺口补进库的条目微矿依然是 null。
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../core/db/schema';
import { addUserAlias, allFoods, upsertFood } from '../core/db/repo';
import {
  guessCategory, medianGrams, reconcileMisses, setMissStatus, similarFoods,
} from '../core/food/miss';
import { facts, type NutritionFacts } from '../core/nutrition/types';
import { NumInput } from '../ui/NumInput';
import { roundGrams } from '../core/meal/grams';
import type { MatchMiss } from '../core/db/types';

type Tab = 'ingredient' | 'dish' | 'dismissed';

const TAB_TEXT: Record<Tab, string> = {
  ingredient: '补进来的条目只带 AI 给的宏量，维生素矿物质仍然是空的 —— 它解决的是「搜得到、份量记得住」，不是「微矿不再是 —」。',
  dish: '菜品不建议入册：同名菜每次做法不同（油糖差一倍），存成固定值是给未来埋错。更好的做法是下次拍照时让它把菜拆成食材。',
  dismissed: '忽略过的名字不会再打扰你。它再出现只累加次数，不会自动弹回来；想放回待处理就点「恢复」。',
};

function agoText(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  return `${d} 天前`;
}

export function MissesPage() {
  const nav = useNavigate();
  const foods = useLiveQuery(() => allFoods(), []);
  const all = useLiveQuery(() => db.misses.toArray(), []);
  const [tab, setTab] = useState<Tab>('ingredient');
  const [editing, setEditing] = useState<string | null>(null);
  const [aliasing, setAliasing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * 打开页面先对一次账：把「现在库里已经能命中」的条目标成已覆盖。
   * 缺口可能是在几周前补上的（种子升级、或用户自己加了别名），
   * 只有显示前重算才能知道它已经不需要处理了。
   */
  useEffect(() => {
    if (foods?.length) void reconcileMisses(foods);
  }, [foods]);

  const rows = (all ?? [])
    .filter((m) => (tab === 'dismissed' ? m.status === 'dismissed' : m.status === 'open' && m.kind === tab))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);

  const openRows = (all ?? []).filter((m) => m.status === 'open');
  const nOf = (k: Tab) => (k === 'dismissed'
    ? (all ?? []).filter((m) => m.status === 'dismissed').length
    : openRows.filter((m) => m.kind === k).length);

  async function dismiss(m: MatchMiss) {
    await setMissStatus(m.nameKey, 'dismissed');
    setEditing(null);
    setAliasing(null);
  }

  async function restore(m: MatchMiss) {
    await setMissStatus(m.nameKey, 'open');
    setTab(m.kind);
  }

  async function link(m: MatchMiss, foodId: string, foodName: string) {
    const r = await addUserAlias(foodId, m.name);
    setAliasing(null);
    if (r === 'ok') {
      await setMissStatus(m.nameKey, 'added');
      setMsg(`已把「${m.name}」记为「${foodName}」的别名，下次识别直接命中。`);
    } else if (r === 'exists') {
      await setMissStatus(m.nameKey, 'added');
      setMsg(`「${foodName}」本来就能匹配这个写法，已销账。`);
    } else if (r === 'conflict') {
      setMsg('这个写法已经被另一条食物占着了 —— 一个写法只能指向一种食物，先去那边确认。');
    } else if (r === 'empty') {
      setMsg('别名至少要两个字：单字别名会把同字食物全吃掉（「鱼」曾让草鱼、鲫鱼全部匹配到鲈鱼）。');
    } else {
      setMsg('这条食物已经不在了，可能刚被删掉。');
    }
  }

  return (
    <>
      <div className="hdr">
        <div>
          <h1>库缺口</h1>
          <div className="sub">认出来、库里没有的名字 · 点一下就能补</div>
        </div>
        <button className="pill" onClick={() => nav('/settings')}>返回</button>
      </div>

      <div className="main">
        <div className="seg">
          <button className={tab === 'ingredient' ? 'on' : ''} onClick={() => setTab('ingredient')}>
            食材 {nOf('ingredient')}
          </button>
          <button className={tab === 'dish' ? 'on' : ''} onClick={() => setTab('dish')}>
            菜品 {nOf('dish')}
          </button>
          <button className={tab === 'dismissed' ? 'on' : ''} onClick={() => setTab('dismissed')}>
            已忽略 {nOf('dismissed')}
          </button>
        </div>

        <div className="hint" style={{ textAlign: 'left', marginTop: 8 }}>{TAB_TEXT[tab]}</div>
        {msg && <div className="hint" style={{ textAlign: 'left', marginTop: 6, color: 'var(--green)' }}>{msg}</div>}

        {rows.length === 0 ? (
          <div className="empty">
            {tab === 'dismissed' ? '还没有忽略过任何名字。' : '这一类暂时没有缺口。'}
            <br />
            {tab !== 'dismissed' && '拍照记录时遇到库里没有的食材，它会自动出现在这里。'}
          </div>
        ) : (
          <div className="misslist">
            {rows.map((m) => {
              const grams = medianGrams(m.grams);
              // 只在展开「归到已有」时才算候选：bigram 扫全库虽然便宜，但没必要每行都扫
              const cands = aliasing === m.nameKey && foods ? similarFoods(m.name, foods, 5) : [];
              return (
                <div className="misscard" key={m.nameKey}>
                  <div className="mhead">
                    <span className="mname">{m.name}</span>
                    <span className="mcount">×{m.count}</span>
                  </div>
                  <div className="mmeta">
                    {grams != null ? `常见 ${grams}g` : '份量未知'} · 最近 {agoText(m.lastAt)}
                  </div>

                  {m.near && m.near.score >= 0.45 && (
                    <div className={`mnear${m.near.matched ? ' warn' : ''}`}>
                      {m.near.matched
                        ? `疑似认成了「${m.near.name}」（${m.near.score.toFixed(2)}），那次的微量可能算错`
                        : `库里最像的是「${m.near.name}」（${m.near.score.toFixed(2)}）`}
                    </div>
                  )}

                  <div className="mact">
                    {m.status === 'dismissed' ? (
                      <button className="mpill" onClick={() => void restore(m)}>恢复</button>
                    ) : (
                      <>
                        <button
                          className="mpill primary"
                          onClick={() => { setEditing(m.nameKey); setAliasing(null); }}
                        >
                          {m.kind === 'dish' ? '仍要入册' : '入册'}
                        </button>
                        <button
                          className="mpill"
                          onClick={() => { setAliasing(m.nameKey); setEditing(null); }}
                        >
                          归到已有
                        </button>
                        <button className="mpill" onClick={() => void dismiss(m)}>忽略</button>
                      </>
                    )}
                  </div>

                  {aliasing === m.nameKey && foods && (
                    <div className="mpick">
                      {cands.map((c) => (
                        <button key={c.id} className="pick" onClick={() => void link(m, c.id, c.name)}>
                          {c.name}<span>{c.score.toFixed(2)}</span>
                        </button>
                      ))}
                      {cands.length === 0 ? (
                        <div className="mhint">
                          库里没有相近的条目 —— 这是个真正的新食物，直接「入册」更合适。
                        </div>
                      ) : (
                        <div className="mhint">点一条就把「{m.name}」记成它的别名，库不增加条目。</div>
                      )}
                    </div>
                  )}

                  {editing === m.nameKey && (
                    <IntoLibraryForm
                      miss={m}
                      onDone={(text) => { setEditing(null); setMsg(text); }}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * 入册表单 —— 全部字段都有预填，用户只需要确认。
 *
 * 预填的来源必须分清：宏量是**当时 AI 给这盘菜的估算**（含油盐口径），
 * 份量是**用户实际吃过几次的中位数**，分类是**本地关键词猜的**。
 * 三者都不是"营养事实"，所以字段全部可改，且默认不填微矿（宁缺勿编）。
 */
function IntoLibraryForm({
  miss,
  onDone,
  onCancel,
}: {
  miss: MatchMiss;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(miss.name);
  const [category, setCategory] = useState(guessCategory(miss.name));
  const [kcal, setKcal] = useState<number | null>(miss.per100g.kcal ?? null);
  const [protein, setProtein] = useState<number | null>(miss.per100g.protein ?? null);
  const [fat, setFat] = useState<number | null>(miss.per100g.fat ?? null);
  const [carbs, setCarbs] = useState<number | null>(miss.per100g.carbs ?? null);
  const [fiber, setFiber] = useState<number | null>(miss.per100g.fiber ?? null);
  const [grams, setGrams] = useState<number | null>(medianGrams(miss.grams));
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = name.trim();
    if (!n) { onDone('名字不能空。'); return; }
    if (kcal == null) { onDone('至少要填热量 —— 没有热量的一条，入册了也只会在搜索里占位。'); return; }
    setBusy(true);
    try {
      const per100g: NutritionFacts = facts({ kcal, protein, fat, carbs, fiber });
      await upsertFood({
        name: n,
        per100g,
        category: category.trim() || '自定义',
        serving: grams != null && grams > 0 ? { quantity: 1, unit: '份', grams: roundGrams(grams) } : null,
      });
      await setMissStatus(miss.nameKey, 'added');
      onDone(`已入库：${n}。下次搜它、拍它都会直接命中；维生素矿物质还是空的，显示「—」。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mform">
      <div className="field">
        <span>名字</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <span>分类</span>
        <input value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <div className="fields">
        <div className="field"><span>热量 kcal</span><NumInput value={kcal} onValue={setKcal} /></div>
        <div className="field"><span>蛋白 g</span><NumInput value={protein} onValue={setProtein} /></div>
        <div className="field"><span>脂肪 g</span><NumInput value={fat} onValue={setFat} /></div>
        <div className="field"><span>碳水 g</span><NumInput value={carbs} onValue={setCarbs} /></div>
        <div className="field"><span>纤维 g</span><NumInput value={fiber} onValue={setFiber} /></div>
        <div className="field"><span>一份 g</span><NumInput value={grams} onValue={setGrams} /></div>
      </div>
      <div className="mhint">
        每 100g 口径。宏量来自那次的 AI 估算（含油盐），份量是你吃过几次的中位数 —— 都可以改。
      </div>
      <div className="mact">
        <button className="mpill primary" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存并入库'}
        </button>
        <button className="mpill" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
