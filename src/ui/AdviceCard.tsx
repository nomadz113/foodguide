/**
 * 每日建议卡。
 *
 * 两层结构，优先级明确：
 * 1. 本地规则建议（advice/local.ts）—— 立即可见、零成本、数字可追溯，作为永远在的兜底。
 * 2. AI 叙述 —— 点一下才生成，缓存在当天；记录变了会被标成过期，不会拿旧结论骗人。
 *
 * 之所以不自动调用：每次约 ¥0.002 且要等 3 秒，用户在早上打开 App 只想看一眼还剩多少热量，
 * 不该为此付出等待。要听解释就点一下，这个选择权应该留给用户。
 */

import { useEffect, useMemo, useState } from 'react';
import { AiError, AI_ERROR_TEXT } from '../core/ai/types';
import { generateAdvice } from '../core/ai/client';
import { deobfuscate } from '../core/ai/keyStore';
import { buildAdvicePayload } from '../core/advice/payload';
import type { LocalAdvice } from '../core/advice/local';
import { adviceForDay, saveAdvice } from '../core/db/repo';
import type { AdviceSnapshot, GoalSnapshot, Meal, Profile, Settings } from '../core/db/types';
import type { NutritionFacts } from '../core/nutrition/types';
import { useAppData } from '../store/AppData';

interface Props {
  local: LocalAdvice;
  totals: NutritionFacts;
  coverage: Partial<Record<keyof NutritionFacts, number>>;
  meals: Meal[];
  profile: Profile;
  goal: GoalSnapshot;
  /** 「早餐 420 · 午餐 650」 */
  planLine: string;
}

function config(settings: Settings) {
  return {
    mode: settings.mode,
    apiKey: deobfuscate(settings.apiKeyCipher),
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: settings.textModel || 'qwen-plus',
  };
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AdviceCard({ local, totals, coverage, meals, profile, goal, planLine }: Props) {
  const { settings, today } = useAppData();
  const [saved, setSaved] = useState<AdviceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hash = goal.sourceProfileHash;

  useEffect(() => {
    let alive = true;
    void adviceForDay(today, hash).then((a) => { if (alive) setSaved(a); });
    return () => { alive = false; };
  }, [today, hash]);

  const payload = useMemo(
    () => buildAdvicePayload({ goal, totals, coverage, meals, profile, hour: new Date().getHours() }),
    [goal, totals, coverage, meals, profile],
  );

  /**
   * 记录变了（补记一餐、删一条）之后，旧建议的依据就不成立了。
   * 不自动重算（那会偷偷花钱），但必须标出来。
   */
  const stale = saved != null && (
    Math.abs(saved.inputs.kcal - payload.kcalIntake) >= 1
    || saved.inputs.mealCount !== payload.meals.length
  );

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await generateAdvice(payload, { config: config(settings) });
      const row = await saveAdvice({
        date: today,
        goalId: goal.id,
        profileHash: hash,
        inputs: {
          kcal: payload.kcalIntake,
          protein: payload.proteinIntake,
          fiber: payload.fiberIntake,
          mealCount: payload.meals.length,
          remain: payload.remain,
          saltG: payload.saltG,
        },
        headline: r.doc.headline,
        body: r.doc.body,
        actions: r.doc.actions,
        caveats: r.doc.caveats,
        source: 'ai',
        model: settings.textModel || 'qwen-plus',
        latencyMs: r.usage.ms,
        usage: {
          promptTokens: r.usage.promptTokens,
          completionTokens: r.usage.completionTokens,
          costCny: r.usage.costCny,
        },
      });
      setSaved(row);
    } catch (e) {
      setErr(e instanceof AiError ? AI_ERROR_TEXT[e.code] : '生成失败，稍后再试');
    } finally {
      setBusy(false);
    }
  }

  const hasKey = settings.mode === 'proxy' || deobfuscate(settings.apiKeyCipher).length > 0;

  return (
    <div className="advice">
      <div className="h">
        <span>{saved ? '✦' : '◎'}</span>
        <span>{saved ? saved.headline : local.headline}</span>
        {saved && <em className="adv-src">AI</em>}
      </div>

      <p>{saved ? saved.body : local.body}</p>

      {saved && saved.actions.length > 0 && (
        <ul className="adv-acts">
          {saved.actions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}

      {stale && (
        <div className="adv-stale">
          这条建议是 {clock(saved!.createdAt)} 生成后、记录又变了，数字已过期
        </div>
      )}

      {saved && saved.caveats.length > 0 && (
        <div className="adv-caveat">{saved.caveats.join('；')}</div>
      )}

      {err && <div className="adv-err">{err}</div>}

      <div className="adv-foot">
        <span className="planline">{planLine || local.plan}</span>
        {hasKey ? (
          <button className="adv-btn" disabled={busy} onClick={() => void run()}>
            {busy ? '正在写…' : saved ? (stale ? '按新记录重写' : '换一种说法') : '让 AI 细说'}
          </button>
        ) : (
          <span className="adv-nokey">设置里填 Key 后可用 AI 建议</span>
        )}
      </div>
    </div>
  );
}
