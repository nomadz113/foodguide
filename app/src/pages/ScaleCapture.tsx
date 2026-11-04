import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { recogniseScale } from '../core/ai/client';
import { pickScaleTime, shouldSyncProfile } from '../core/scale/time';
import { checkScaleReading } from '../core/scale/guard';
import { AiError, AI_ERROR_TEXT } from '../core/ai/types';
import { deobfuscate } from '../core/ai/keyStore';
import { latestWeight, upsertWeightScale } from '../core/db/repo';
import { readPhotoTime, TIME_SOURCE_LABEL } from '../core/media/takenAt';
import { buildGoalSnapshot } from '../core/goal/engine';
import { dayKey, formatDayLabel } from '../core/date';
import type { BpTimeSource } from '../core/db/types';
import { useAppData } from '../store/AppData';
import { NumInput } from '../ui/NumInput';

/**
 * 从截图录入体重与体脂率。
 *
 * 为什么不是「接入 Keep 的接口」：Keep 的开放平台只对硬件厂商开放 OAuth，
 * 没有面向个人的体重/体成分 API。所以这里走识别 —— 和血压那条链路同构，
 * 只认数字，判断留给代码。
 *
 * 这张卡比血压的确认卡多承担一件事：**让用户看见后果**。
 * 体脂率一旦有值，档案的 BMR 会从 Mifflin 换成 Katch-McArdle，
 * 当天的热量目标跟着变。如果不提前说，用户会以为"只是多记了一个数"，
 * 然后在主页看到一个莫名其妙变小的数字。
 *
 * 另外它不做「无感写入」：识别结果一律先填到卡上，点保存才落库。
 * 一条读错的体重会重算 BMR → TDEE → 热量 → 蛋白/脂肪/碳水，静默影响后续所有建议。
 */

type Phase = 'idle' | 'reading' | 'ready' | 'error';

const pad = (n: number) => String(n).padStart(2, '0');

/** Date → datetime-local 需要的字符串（本地时区，不涉 UTC） */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

export function ScaleCapturePage() {
  const { profile, goal, settings, today, applyProfile } = useAppData();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<{ text: string; code: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 一律 number|null：没读到就是 null，绝不退化成 0（0% 体脂率会被当成有效值）
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [bodyFatPct, setBodyFatPct] = useState<number | null>(null);
  const [when, setWhen] = useState<string>(() => toLocalInput(Date.now()));
  const [timeSource, setTimeSource] = useState<BpTimeSource>('now');
  /** 截图只印了日期，时分是从截图文件时间借来的 */
  const [clockFromFile, setClockFromFile] = useState(false);
  const [note, setNote] = useState('');

  const [recognised, setRecognised] = useState(false);
  const [rawSegments, setRawSegments] = useState<string[]>([]);
  const [warn, setWarn] = useState<string | null>(null);
  const [saveWarn, setSaveWarn] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // 最近一条体重记录：决定这次是「更新档案」还是「只补录历史」。
  // 保存前要先读它 —— 写完再读，新写的这条就成了 latest，比较永远成立。
  const latest = useLiveQuery(() => latestWeight(), []);

  async function recognise(file: File) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase('reading');
    setErr(null);
    setWarn(null);
    setSaveWarn(null);
    setRecognised(false);
    setPreview(URL.createObjectURL(file));

    const cfg = {
      mode: settings.mode,
      apiKey: deobfuscate(settings.apiKeyCipher),
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: settings.visionModel || 'qwen3-vl-plus',
    };

    // 时间兜底与识别并行，两者互不相干
    const timeP = readPhotoTime({ blob: file, name: file.name, lastModified: file.lastModified });

    try {
      // 只取 draft：体重记录表（WeightEntry）没有 aiMeta 字段，
      // 这一次的耗时/费用没有地方安放，就不假装记下来了。
      const { draft } = await recogniseScale(file, { config: cfg, signal: ctrl.signal });
      const fallback = await timeP;

      // 截图没有 EXIF，mtime 通常就是截图那一刻 —— 正好是「今天」的基准。
      const picked = pickScaleTime(draft.timeText, fallback);
      setWhen(toLocalInput(picked.measuredAt));
      setTimeSource(picked.source);
      setClockFromFile(picked.clockFromFile);
      setRawSegments(draft.rawSegments);

      const outcome = checkScaleReading({
        weight: draft.weight,
        unit: draft.unit,
        bodyFatPct: draft.bodyFatPct,
      });

      if (outcome.ok) {
        setWeightKg(outcome.reading.weightKg);
        setBodyFatPct(outcome.reading.bodyFatPct);
        setRecognised(true);

        const notes: string[] = [];
        if (outcome.converted) notes.push('截图单位是 lb，已换算成 kg');
        if ((draft.confidence ?? 1) < 0.7) notes.push('这次读数把握不大，请对着截图核对一遍');
        if (draft.isAggregate === true) notes.push('截图上是平均值，不是某一次的测量');
        setWarn(notes.length ? notes.join('；') : null);
      } else {
        setWeightKg(null);
        setBodyFatPct(null);
        setErr({ text: outcome.reason, code: 'bad_json' });
      }

      setNote(draft.note ?? '');
      setPhase('ready');
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
    void recognise(f);
  }

  // 表单里的值一律按 kg 再校验一遍：用户可能手改了任意一项
  const checked = checkScaleReading({ weight: weightKg, unit: 'kg', bodyFatPct });
  const previewOk = checked.ok;
  const previewReading = previewOk ? checked.reading : null;

  const whenMs = fromLocalInput(when);
  const future = whenMs != null && whenMs > Date.now() + 5 * 60_000;
  const willArchiveAs = whenMs != null ? dayKey(whenMs, settings.dayStartHour) : today;
  const crossDay = willArchiveAs !== today;

  // 补录历史时不该动档案的「当前体重」—— 否则档案会退回三天前的数字
  const willSyncProfile = shouldSyncProfile(willArchiveAs, latest?.date ?? null);

  // 后果预览：填了体脂率，BMR 会换公式；体重变了，热量目标也会变
  const nextGoal = previewReading
    ? buildGoalSnapshot(
        {
          ...profile,
          weightKg: previewReading.weightKg,
          bodyFatPct: previewReading.bodyFatPct ?? profile.bodyFatPct,
        },
        { from: today },
      )
    : null;
  const formulaSwitch = profile.bodyFatPct == null && (previewReading?.bodyFatPct ?? null) != null;
  const kcalDelta = nextGoal ? nextGoal.kcal - goal.kcal : 0;

  async function save() {
    setSaveWarn(null);
    const r = checkScaleReading({ weight: weightKg, unit: 'kg', bodyFatPct });
    if (!r.ok) {
      setSaveWarn(r.reason);
      return;
    }
    const ms = fromLocalInput(when);
    if (ms == null) {
      setSaveWarn('测量时间看不懂，请重新选一下');
      return;
    }
    if (ms > Date.now() + 5 * 60_000) {
      setSaveWarn('测量时间比现在还晚，检查一下日期');
      return;
    }

    const day = dayKey(ms, settings.dayStartHour);
    setSaving(true);
    try {
      // 先取 latest 再写，否则刚写的这条会变成 latest，比较永远成立
      const before = await latestWeight();
      const sync = shouldSyncProfile(day, before?.date ?? null);

      await upsertWeightScale(day, r.reading.weightKg, r.reading.bodyFatPct);

      if (sync) {
        await applyProfile({
          ...profile,
          weightKg: r.reading.weightKg,
          // 没读到体脂率时保留档案原值 —— 一次只测体重的记录不该把体脂率清空
          bodyFatPct: r.reading.bodyFatPct ?? profile.bodyFatPct,
        });
      }

      // replace：栈原本是 [档案]→[截图]，保存后按一次返回不该退回已提交的空白表单
      nav('/profile', { replace: true });
    } catch (e) {
      setSaveWarn(e instanceof Error ? `保存失败：${e.message}` : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const lowKey = settings.mode === 'direct' && !settings.apiKeyCipher;

  return (
    <>
      <div className="sheetbar">
        <button onClick={() => nav(-1)}>取消</button>
        <h2>从截图记体重</h2>
        <button className="primary" disabled={phase !== 'ready' || !previewOk || saving} onClick={() => void save()}>
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
                  选一张 Keep（或其它体脂秤 App）的体重截图，
                  <br />
                  我把体重、体脂率和测量时间都带上。
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                className="pill ok"
                style={{ flex: 1, height: 46 }}
                disabled={lowKey}
                onClick={() => fileRef.current?.click()}
              >
                从相册选截图
              </button>
            </div>
            <div className="hint" style={{ marginTop: 14, textAlign: 'center', lineHeight: 1.6 }}>
              只采用体重和体脂率，截图里的 BMI、肌肉量、水分率一律不用
            </div>
            <div className="hint" style={{ marginTop: 8, textAlign: 'center', lineHeight: 1.6 }}>
              识别要把图片发到阿里云百炼，截图里请避开昵称和头像
            </div>
          </>
        )}

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />

        {phase === 'reading' && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <b>正在读截图…</b>
            </div>
            <div className="hint" style={{ marginTop: 10, opacity: 0.7 }}>
              同时也在查这张图的来源时间，用来归档
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
              <button className="pill" style={{ flex: 1 }} onClick={() => setPhase('ready')}>
                自己填
              </button>
              <button
                className="pill"
                style={{ flex: 1 }}
                onClick={() => {
                  setPreview(null);
                  setErr(null);
                  setRawSegments([]);
                  setRecognised(false);
                  setPhase('idle');
                }}
              >
                换一张
              </button>
            </div>
            {/* 读不出来也照样能记：表单就在下面，不把用户锁死在重试上 */}
            <div className="hint" style={{ marginTop: 10, textAlign: 'left', lineHeight: 1.6 }}>
              数字只能你自己对着截图填了。下面的表单已经打开，填完照样能保存。
            </div>
          </>
        )}

        {(phase === 'ready' || phase === 'error') && (
          <>
            {preview && <img className="shot" src={preview} alt="体重截图" />}

            {warn && (
              <div className="alert" style={{ marginTop: 12 }}>
                {warn}
              </div>
            )}

            <div className="card" style={{ marginTop: 12 }}>
              <div className="flabel">读数</div>
              <div className="grid" style={{ marginTop: 6 }}>
                <label className="field">
                  <span>体重 kg</span>
                  <NumInput value={weightKg} onValue={setWeightKg} placeholder="72.4" ariaLabel="体重" />
                </label>
                <label className="field">
                  <span>体脂率 %（选填）</span>
                  <NumInput value={bodyFatPct} onValue={setBodyFatPct} placeholder="22.8" ariaLabel="体脂率" />
                </label>
              </div>

              {!previewOk && checked.ok === false && (
                <div className="hint" style={{ marginTop: 8, color: 'var(--amber)' }}>
                  {checked.reason}
                </div>
              )}
            </div>

            <div className="card">
              <label className="field">
                <span>测量时间</span>
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value);
                    // 手改过就不该再声称来源是截图上的时间
                    setTimeSource('user');
                    setClockFromFile(false);
                  }}
                  aria-label="测量时间"
                />
              </label>
              <div className="hint" style={{ marginTop: 6, textAlign: 'left', lineHeight: 1.6 }}>
                来源：{TIME_SOURCE_LABEL[timeSource]}
                {clockFromFile && ' · 页面只印了日期，时分取自截图时间'}
                {recognised && ' · 数字来自截图识别'}
                {crossDay && (
                  <>
                    {' · 会归到 '}
                    <b>{formatDayLabel(willArchiveAs, today)}</b>
                  </>
                )}
                {future && (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--amber)' }}>比现在还晚</span>
                  </>
                )}
              </div>
            </div>

            {/* 后果预告。这一段存在的理由：体脂率不只多一个数字，它换的是计算链路。 */}
            {previewReading && (
              <div className="card">
                <div className="row">
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--dim)' }}>保存后会怎样</span>
                </div>
                <div className="hint" style={{ marginTop: 6, textAlign: 'left', lineHeight: 1.7 }}>
                  {willSyncProfile ? (
                    <>
                      档案体重会更新为 <b>{previewReading.weightKg} kg</b>
                      {previewReading.bodyFatPct != null && <>、体脂率 <b>{previewReading.bodyFatPct}%</b></>}
                    </>
                  ) : (
                    <>
                      这是补录到 <b>{formatDayLabel(willArchiveAs, today)}</b> 的记录，只进趋势，不会改档案里的当前体重
                    </>
                  )}
                  {formulaSwitch && (
                    <>
                      <br />
                      填了体脂率之后，基础代谢从 Mifflin 公式改用 Katch-McArdle 估算。
                    </>
                  )}
                  {kcalDelta !== 0 && (
                    <>
                      <br />
                      每日热量目标 <b>{goal.kcal}</b> → <b>{nextGoal!.kcal}</b> kcal
                      <span style={{ color: kcalDelta > 0 ? 'var(--green)' : 'var(--amber)' }}>
                        （{kcalDelta > 0 ? '+' : ''}
                        {kcalDelta}）
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="card">
              <label className="field">
                <span>备注（选填）</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="如：晨起空腹、运动后"
                  maxLength={80}
                  aria-label="备注"
                />
              </label>
            </div>

            {rawSegments.length > 0 && (
              <div className="hint" style={{ marginTop: 8, textAlign: 'left', lineHeight: 1.6, opacity: 0.75 }}>
                模型当时读到的原始片段：{rawSegments.join(' / ')}
                <br />
                不存截图的情况下，这是区分「读错了」还是「截图就是这么显示的」的唯一凭据。
              </div>
            )}

            {saveWarn && (
              <div className="alert error" style={{ marginTop: 12 }}>
                {saveWarn}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
