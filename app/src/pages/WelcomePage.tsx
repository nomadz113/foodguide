/**
 * 首次引导。三步：身体数据 → 目标 → AI。
 *
 * 为什么需要这一页：
 * 旧版本在 nobody 填过任何东西时就写了一份默认档案（175cm/78kg/男/减脂到 68kg），
 * 直接算目标并显示在首页。任何人第一次打开都会看到一个「为他算好」的热量目标，
 * 而那套数字与使用者无关。这一页把那些数字换成本人填的。
 *
 * 设计上的两个决定：
 * ① 顺序是身体 → 目标，不是目标 → 身体。目标体重、速度、目标热量全都依赖
 *    当前体重，先问目标的话用户得对着一个假体重做决定。
 * ② 每一步都实时算出数字给用户看（BMI、目标热量、预计周数）。这比任何
 *    「我们算得很准」的文案都有说服力 —— 用户能看见数字是从自己填的东西里长出来的。
 */
import { useMemo, useState } from 'react';
import type { ActivityLevel, Profile } from '../core/db/types';
import {
  ACTIVITY_FACTOR, ACTIVITY_LABELS, GOAL_OPTIONS, PACE_OPTIONS,
  ageYears, bmi, buildGoalSnapshot,
} from '../core/goal/engine';
import { patchSettings } from '../core/db/repo';
import { obfuscate } from '../core/ai/keyStore';
import { NumInput } from '../ui/NumInput';

const STEP_TITLES = ['你的身体数据', '你想达到什么', '拍照识别需要 AI'] as const;

/** AI 那一步的选择。`key` 让用户当场填，`skip` 让他先用手动记录 */
type AiChoice = 'key' | 'skip';

/**
 * 必须由本人确认过才放行的字段。
 *
 * 为什么需要这一层：初始档案里带着一组**合法但虚构**的示例值
 * （1996-04-18 / 175cm / 78kg / 男），而下面的校验只检查取值是否在合理区间 ——
 * 于是连点三次「下一步」就能带着别人的身体数据算出一套热量目标。
 * 那与旧版本静默写默认档案是同一个后果，区别只是多了三次点击。
 *
 * 性别也算在内：Mifflin 公式里男女差 166 kcal，猜错比体重错 2kg 严重得多。
 */
type ConfirmKey = 'sex' | 'birthDate' | 'heightCm' | 'weightKg';
const CONFIRM_KEYS: ConfirmKey[] = ['sex', 'birthDate', 'heightCm', 'weightKg'];


interface Props {
  /** 表单占位值。每一个数字都还没被本人确认过 */
  initial: Profile;
  onDone: (p: Profile) => Promise<void>;
}

export function WelcomePage({ initial, onDone }: Props) {
  const [draft, setDraft] = useState<Profile>(initial);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 不预选：这一步的价值就是让人**主动**做一次选择，预选会让「先不用」变成默认偷懒
  const [aiChoice, setAiChoice] = useState<AiChoice | null>(null);
  const [keyInput, setKeyInput] = useState('');

  /** 哪些字段已经被本人操作过一次。见 CONFIRM_KEYS 上方的说明 */
  const [confirmed, setConfirmed] = useState<Record<ConfirmKey, boolean>>({
    sex: false, birthDate: false, heightCm: false, weightKg: false,
  });

  function patch<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft((p) => ({ ...p, [key]: value }));
    setErr(null);
    if ((CONFIRM_KEYS as readonly string[]).includes(key as string)) {
      setConfirmed((c) => ({ ...c, [key as ConfirmKey]: true }));
    }
  }

  const age = ageYears(draft.birthDate);
  const bmiRes = bmi(draft.weightKg, draft.heightCm);

  /** 目标预览。纯函数，不写库，填的过程中随时重算 */
  const goalPreview = useMemo(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      return buildGoalSnapshot(draft, { from: today, makeId: () => 'preview' });
    } catch {
      return null;
    }
  }, [draft]);

  // ── 每步的通过条件。故意只校验这一步用到的东西 ──
  const pendingCount = CONFIRM_KEYS.filter((k) => !confirmed[k]).length;
  const step1Ok = pendingCount === 0
    && draft.heightCm >= 120 && draft.heightCm <= 230
    && draft.weightKg >= 30 && draft.weightKg <= 300
    && age >= 16
    && !!draft.birthDate;

  const needTarget = draft.goalType === 'lose' || draft.goalType === 'gain';
  const step2Ok = !needTarget || (
    draft.targetWeightKg != null
    && draft.targetWeightKg >= 30
    && draft.targetWeightKg <= 300
    && (draft.goalType === 'lose' ? draft.targetWeightKg < draft.weightKg : draft.targetWeightKg > draft.weightKg)
    && (draft.paceKgPerWeek ?? 0) > 0
    && (draft.paceKgPerWeek ?? 0) <= draft.weightKg * 0.01
  );

  const step3Ok = aiChoice != null && (aiChoice !== 'key' || keyInput.trim().length > 8);

  const canNext = step === 0 ? step1Ok : step === 1 ? step2Ok : step3Ok;

  function next() {
    if (!canNext) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    void submit();
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      // 显式写一次 mode：默认值虽然是 direct，但备份恢复可能带进来 proxy
      if (aiChoice === 'key' && keyInput.trim()) {
        await patchSettings({ mode: 'direct', apiKeyCipher: obfuscate(keyInput.trim()) });
      } else if (aiChoice === 'skip') {
        await patchSettings({ mode: 'direct', apiKeyCipher: null });
      }
      await onDone(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const step2Issue = !needTarget ? null
    : draft.targetWeightKg == null ? '请填写目标体重'
      : draft.goalType === 'lose' && draft.targetWeightKg >= draft.weightKg ? '减脂的目标体重应低于当前体重'
        : draft.goalType === 'gain' && draft.targetWeightKg <= draft.weightKg ? '增肌的目标体重应高于当前体重'
          : (draft.paceKgPerWeek ?? 0) > draft.weightKg * 0.01 ? '这个速度超过每周体重的 1%，建议放慢'
            : null;

  return (
    <div className="welcome">
      <div className="whead">
        <div className="wstep" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
          ))}
        </div>
        <div className="wcount">第 {step + 1} 步，共 3 步</div>
        <h1>{STEP_TITLES[step]}</h1>
        <p className="wsub">
          {step === 0 && '用来算基础代谢。所有数据只存在这台手机上，不上传。'}
          {step === 1 && '目标决定每天吃多少、蛋白给多少。之后随时能在档案里改。'}
          {step === 2 && '不填也能用，只是拍照识别要手动搜食物代替。'}
        </p>
      </div>

      <div className="wbody">
        {step === 0 && (
          <>
            <div className={`seg${confirmed.sex ? '' : ' unsure'}`}>
              {(['male', 'female'] as const).map((s) => (
                <button key={s} className={draft.sex === s ? 'on' : ''} onClick={() => patch('sex', s)}>
                  {s === 'male' ? '男' : '女'}
                </button>
              ))}
            </div>

            <label className={`field${confirmed.birthDate ? '' : ' unsure'}`} style={{ marginTop: 10 }}>
              <span>出生日期</span>
              <input type="date" value={draft.birthDate} onChange={(e) => patch('birthDate', e.target.value)} />
            </label>

            <div className="grid" style={{ marginTop: 9 }}>
              <label className={`field${confirmed.heightCm ? '' : ' unsure'}`}>
                <span>身高 cm</span>
                <NumInput value={draft.heightCm} onValue={(v) => { if (v != null) patch('heightCm', v); }} />
              </label>
              <label className={`field${confirmed.weightKg ? '' : ' unsure'}`}>
                <span>体重 kg</span>
                <NumInput value={draft.weightKg} onValue={(v) => { if (v != null) patch('weightKg', v); }} />
              </label>
            </div>

            <label className="field" style={{ marginTop: 9 }}>
              <span>日常活动量（不含专门运动）</span>
              <select
                value={draft.activityLevel}
                onChange={(e) => patch('activityLevel', e.target.value as ActivityLevel)}
              >
                {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
                  <option key={k} value={k}>×{ACTIVITY_FACTOR[k]} · {ACTIVITY_LABELS[k]}</option>
                ))}
              </select>
            </label>

            <div className={`wnote${pendingCount > 0 ? ' warn' : ''}`}>
              {pendingCount === CONFIRM_KEYS.length
                ? <>带<b>虚线</b>的四项是示例值，点一下或改成你自己的才能继续。这些数字直接决定每天的热量目标，填错会让提醒全部失准。</>
                : pendingCount > 0
                  ? <>还有 <b>{pendingCount}</b> 项停在示例值（虚线）。它们同样决定热量目标，请逐个确认。</>
                  : <>身体数据已全部确认。活动量按「不含专门运动」的日常估算，之后在档案里随时能改。</>}
            </div>

            <div className="wsum">
              <div className="wsum-k">你的 BMI</div>
              <div className="wsum-v">
                {bmiRes.value.toFixed(1)}<small>{bmiRes.label}</small>
              </div>
              <div className="wsum-n">{age} 岁</div>
              {goalPreview && (
                <div className="wsum-split">
                  <div>
                    <span>基础代谢</span>
                    <b>{goalPreview.bmr.toLocaleString()}<i>kcal</i></b>
                  </div>
                  <div>
                    <span>每日消耗</span>
                    <b>{goalPreview.tdee.toLocaleString()}<i>kcal</i></b>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="wgoals">
              {GOAL_OPTIONS.map((g) => (
                <button
                  key={g.key}
                  className={draft.goalType === g.key ? 'on' : ''}
                  onClick={() => {
                    patch('goalType', g.key);
                    // 从减脂切到增肌时，旧目标体重在反方向，留着必然报错
                    if (g.key === 'gain' && (draft.targetWeightKg ?? 0) <= draft.weightKg) {
                      patch('targetWeightKg', Math.round((draft.weightKg + 4) * 10) / 10);
                    }
                  }}
                >
                  <b>{g.label}</b>
                  <i>{g.blurb}</i>
                </button>
              ))}
            </div>

            {needTarget && (
              <div className="grid" style={{ marginTop: 10 }}>
                <label className="field">
                  <span>目标体重 kg</span>
                  <NumInput value={draft.targetWeightKg} onValue={(v) => patch('targetWeightKg', v)} />
                </label>
                <label className="field">
                  <span>速度 kg / 周</span>
                  <select
                    value={String(draft.paceKgPerWeek ?? 0.5)}
                    onChange={(e) => patch('paceKgPerWeek', Number(e.target.value))}
                  >
                    {PACE_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}{p === 0.5 ? '（推荐）' : p === 1 ? '（激进）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {goalPreview && (
              <div className="wsum">
                <div className="wsum-k">每天的目标热量</div>
                <div className="wsum-v">
                  {goalPreview.kcal.toLocaleString()}<small>kcal</small>
                </div>
                <div className="wsum-n">
                  蛋白 {goalPreview.proteinG}g · 脂肪 {goalPreview.fatG}g · 碳水 {goalPreview.carbsG}g
                </div>
                {goalPreview.projectedDays != null && (
                  <div className="wsum-n">
                    按这个速度约 {Math.round(goalPreview.projectedDays / 7)} 周达到 {goalPreview.targetWeightKg} kg
                  </div>
                )}
                {goalPreview.warnings.length > 0 && (
                  <div className="wsum-warn">{goalPreview.warnings[0]}</div>
                )}
              </div>
            )}

            {step2Issue && (
              <div className="alert error" style={{ marginTop: 10 }}>
                <span>{step2Issue}</span>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="wchoices">
              <button
                className={`wchoice${aiChoice === 'key' ? ' on' : ''}`}
                onClick={() => setAiChoice('key')}
              >
                <b>填写阿里云百炼 API Key<em className="wtag">推荐</em></b>
                <i>拍照后自动识别食物和克数，这是这个 App 的主要用法。Key 只存在这台手机上。</i>
              </button>
              <button
                className={`wchoice${aiChoice === 'skip' ? ' on' : ''}`}
                onClick={() => setAiChoice('skip')}
              >
                <b>先不用 AI</b>
                <i>手动搜索食物记录，内置 174 条常见食物。随时能在设置里补上 Key。</i>
              </button>
            </div>

            {aiChoice === 'key' && (
              <>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>API Key</span>
                  <input
                    type="password"
                    value={keyInput}
                    placeholder="sk-..."
                    autoComplete="off"
                    onChange={(e) => setKeyInput(e.target.value)}
                  />
                </label>
                <div className="wnote">
                  在阿里云百炼控制台「API-KEY 管理」里创建。
                  识别一张图大约 1 分钱，Key 只写在本机数据库，不会上传到任何第三方。
                </div>
              </>
            )}

            {aiChoice === 'skip' && (
              <div className="wnote">
                不填 Key 时，拍照页会提示识别不可用，你可以用「直接搜食物记一餐」手动记录。
                之后在「档案」页右上角的「设置」里随时能补。
              </div>
            )}

            <div className="wnote">
              有一点先说清楚：<b>AI 看照片估份量一定有误差</b>，油和米饭尤其明显。
              识别完的确认页可以逐项改克数，「把握不大」的项会单独标出来。
              别把它当成称重，当成一个改起来很快的初稿。
            </div>

            <div className="wnote">
              最后说一件容易被误会的事：<b>这个 App 没有账号</b>。
              所有记录都在本机，换手机或重装系统要靠「设置 → 导出备份」搬运，
              不会自动同步回来。
            </div>
          </>
        )}

        {err && <div className="alert error" style={{ marginTop: 10 }}><span>{err}</span></div>}
      </div>

      <div className="wfoot">
        {step > 0 && (
          <button className="wback" onClick={() => setStep(step - 1)} disabled={busy}>上一步</button>
        )}
        <button className="wnext" onClick={next} disabled={!canNext || busy}>
          {busy ? '正在保存…' : step === 2 ? '开始使用' : '下一步'}
        </button>
      </div>
    </div>
  );
}
