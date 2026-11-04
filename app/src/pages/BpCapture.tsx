import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recogniseBp } from '../core/ai/client';
import { pickBpTime } from '../core/bp/time';
import { AiError, AI_ERROR_TEXT } from '../core/ai/types';
import { deobfuscate } from '../core/ai/keyStore';
import { putBp } from '../core/db/repo';
import { readPhotoTime, TIME_SOURCE_LABEL } from '../core/media/takenAt';
import { checkReading } from '../core/bp/guard';
import { BP_LABEL, classify, pulsePressure, toneOf } from '../core/bp/engine';
import { dayKey, formatDayLabel } from '../core/date';
import { draftFlags, manualFlags, pickBpSource } from '../core/bp/entry';
import type { BpFlags, BpTimeSource } from '../core/db/types';
import { useAppData } from '../store/AppData';
import { NumInput } from '../ui/NumInput';
import { TONE_VAR } from '../ui/bpTone';
import { probeCamera, type CameraStatus } from '../native/probe';

/**
 * 血压录入 —— 「确认卡」是整个功能的安全闸门。
 *
 * 拍照识别在这里有一个和食物识别完全不同的性质：**食物份量差 30 克，用户第二天照样吃饭；
 * 血压读数错一位，用户会去医院。** 所以这张卡上每一个数字都必须可改，
 * 而且不做任何自动修正 —— 校验不通过就告诉用户哪一项不对，让他自己看屏幕改。
 *
 * 时间也是这张卡的一部分。归档日由 measuredAt 推算，所以时间改一格，
 * 记录可能从「今天」跳到「昨天」，这是预期的（补录场景），但必须让用户当时就看见。
 */

type Phase = 'idle' | 'reading' | 'ready' | 'error';

const pad = (n: number) => String(n).padStart(2, '0');

/** 三态小按钮，配色与 .tiers3 / .theme-seg 完全一致 —— 选中态不该在每个页面各长一个样 */
function chipStyle(on: boolean): React.CSSProperties {
  return {
    padding: '3px 10px',
    borderRadius: 'var(--radius-pill)',
    fontSize: 'var(--fs-caption)',
    // 选中态不靠字重区分（全项目只有 400/500 两档），靠底色 + 描边 + 文字色
    fontWeight: 'var(--fw-emphasis)',
    border: `1px solid ${on ? 'var(--ok-line)' : 'var(--line-soft)'}`,
    background: on ? 'var(--ok-bg)' : 'transparent',
    color: on ? 'var(--ok-fg)' : 'var(--mute)',
  };
}

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

export function BpCapturePage({ manual = false }: { manual?: boolean } = {}) {
  const { settings, today } = useAppData();
  const nav = useNavigate();
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [camStatus, setCamStatus] = useState<CameraStatus | null>(null);
  // manual：跳过拍照，直接落到空表单。纸质化验单、体检报告也能进同一张表。
  const [phase, setPhase] = useState<Phase>(manual ? 'ready' : 'idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<{ text: string; code: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 表单。读数一律 number|null：没读到就是 null，绝不退化成 0（0 会被当真）
  const [sys, setSys] = useState<number | null>(null);
  const [dia, setDia] = useState<number | null>(null);
  const [pulse, setPulse] = useState<number | null>(null);
  const [when, setWhen] = useState<string>(() => toLocalInput(Date.now()));
  // manual 时时间由用户直接认定（哪怕没改那个默认值），来源就标 user；
  // 拍照时先写 now，认出屏幕/EXIF 后由 recognise() 覆盖成真正的来源
  const [timeSource, setTimeSource] = useState<BpTimeSource>(manual ? 'user' : 'now');
  const [device, setDevice] = useState('');
  const [note, setNote] = useState('');
  // ① 这次的来源：由 pickBpSource 决定，只有一次**成功**的识别才算 photo。
  //    拍照没认出来、数字是用户手打的，来源必须诚实地写成 manual。
  const [recognised, setRecognised] = useState(false);
  // ② 模型在屏幕上看到的附加信息。这两个值会跟着记录一辈子 ——
  //    心律不齐标记是就医时的线索，平均值标记决定这条能不能进趋势图。
  const [flags, setFlags] = useState<BpFlags>(manualFlags);
  const [recognisedMs, setRecognisedMs] = useState(0);
  const [warn, setWarn] = useState<string | null>(null);
  const [saveWarn, setSaveWarn] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void probeCamera().then((s) => alive && setCamStatus(s));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function recognise(file: File) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase('reading');
    setErr(null);
    setWarn(null);
    setSaveWarn(null);
    setRecognised(false);
    const url = URL.createObjectURL(file);
    setPreview(url);

    // 时间兜底与识别并行：两者互不相干，串行只会白白多等一次网络往返
    const cfg = {
      mode: settings.mode,
      apiKey: deobfuscate(settings.apiKeyCipher),
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: settings.visionModel || 'qwen3-vl-plus',
    };

    const timeP = readPhotoTime({ blob: file, name: file.name, lastModified: file.lastModified });

    try {
      const { draft, usage } = await recogniseBp(file, { config: cfg, signal: ctrl.signal });
      const fallback = await timeP;

      // ① 时刻：屏幕显示 > EXIF > 文件名 > 文件修改时间 > 现在。
      //    抽在 pickBpTime 里是因为这个决定错了不会报错，只会默默归到另一天。
      const picked = pickBpTime(draft.displayedAt, fallback);
      setWhen(toLocalInput(picked.measuredAt));
      setTimeSource(picked.source);

      // 屏幕上的附加标记跟着读数一起留痕：null 也要留着，
      // 「没识别出心律不齐图标」和「这次心律整齐」是两件事。
      setFlags(draftFlags(draft));

      // ② 读数：换算与区间检查都在 guard 里。失败不填表，交由用户手打。
      const outcome = checkReading({
        systolic: draft.systolic,
        diastolic: draft.diastolic,
        pulse: draft.pulse,
        unit: draft.unit,
      });
      if (outcome.ok) {
        setSys(outcome.reading.systolic);
        setDia(outcome.reading.diastolic);
        setPulse(outcome.reading.pulse);
        setRecognised(true);
        setRecognisedMs(usage.ms);
        if (outcome.converted) setWarn('屏幕单位 kPa，已换算为 mmHg');
        if ((draft.confidence ?? 1) < 0.7) setWarn('这次读数把握不大，请对着屏幕核对一遍');
      } else {
        setSys(null);
        setDia(null);
        setPulse(null);
        setErr({ text: outcome.reason, code: 'bad_json' });
      }

      // 平均值必须显式警告：把它当一次新测量，趋势图会被一个假点拉平
      if (draft.isAverage) {
        setWarn(
          (w) => (w ? `${w}；` : '') + '屏幕上标了这是平均值，不是当次测量',
        );
      }
      setDevice(draft.device ?? '');
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

  const checked = checkReading({ systolic: sys, diastolic: dia, pulse, unit: 'mmHg' });
  const previewOk = checked.ok;
  const previewReading = previewOk ? checked.reading : null;
  const tone = previewReading ? toneOf(previewReading) : null;
  const cat = previewReading ? classify(previewReading) : null;
  const whenMs = fromLocalInput(when);
  const future = whenMs != null && whenMs > Date.now() + 5 * 60_000;
  // 归档日按 dayStartHour 切：凌晨 1 点的记录算「昨天」，和吃饭同口径
  const willArchiveAs = whenMs != null ? dayKey(whenMs, settings.dayStartHour) : today;
  const crossDay = willArchiveAs !== today;

  async function save() {
    setSaveWarn(null);
    const r = checkReading({ systolic: sys, diastolic: dia, pulse, unit: 'mmHg' });
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

    setSaving(true);
    try {
      await putBp({
        measuredAt: ms,
        date: dayKey(ms, settings.dayStartHour),
        systolic: r.reading.systolic,
        diastolic: r.reading.diastolic,
        pulse: r.reading.pulse,
        device: device.trim() || null,
        source: pickBpSource({ manual, recognised }),
        timeSource,
        flags,
        note: note.trim() || null,
        // 只有真正跑过识别才谈得上 aiMeta；手填的记录不假装自己是识别来的
        aiMeta: recognised
          ? {
              provider: 'bailian',
              model: settings.visionModel || 'qwen3-vl-plus',
              promptVersion: 'bp-v1',
              latencyMs: recognisedMs,
              jsonMode: 'json_object',
              repaired: false,
            }
          : null,
      });
      // replace 而不是 push：栈原本是 [首页]→[表单]→[血压页]，保存后按一次返回
      // 会退回一张已经提交过的空白表单。换成 replace 之后是 [首页]→[血压]，返回即回首页。
      nav('/stats?tab=bp', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  const lowKey = settings.mode === 'direct' && !settings.apiKeyCipher;

  return (
    <>
      <div className="sheetbar">
        <button onClick={() => nav(-1)}>取消</button>
        <h2>记一次血压</h2>
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
                  拍一张血压计的屏幕，
                  <br />
                  我把读数、时间和来源都带上。
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                className="pill ok"
                style={{ flex: 1, height: 46 }}
                disabled={lowKey}
                onClick={() => camRef.current?.click()}
              >
                拍照
              </button>
              <button
                className="pill"
                style={{ flex: 1, height: 46 }}
                disabled={lowKey}
                onClick={() => fileRef.current?.click()}
              >
                从相册选
              </button>
            </div>
            {camStatus && !camStatus.canCapture && (
              <div className="hint" style={{ marginTop: 10, textAlign: 'left', lineHeight: 1.55 }}>
                这台机器没有能被调起的相机应用（Android {camStatus.sdk}，查到 {camStatus.cameraApps} 个）。
                点「拍照」只会打开相册，请用「从相册选」。
              </div>
            )}
            <div className="hint" style={{ marginTop: 14, textAlign: 'center' }}>
              屏幕上的数字会被逐个核一遍，保存前你可以改任何一个
            </div>
            <div className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
              不想拍照？
              <button style={{ color: 'var(--green)', marginLeft: 2 }} onClick={() => nav('/bp/manual')}>
                手动输入
              </button>
            </div>
          </>
        )}

        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />

        {phase === 'reading' && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <b>正在读屏幕…</b>
            </div>
            <div className="hint" style={{ marginTop: 10, opacity: 0.7 }}>
              同时也在查照片的拍摄时间，用来归档
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
                  setFlags(manualFlags());
                  setRecognised(false);
                  setPhase('idle');
                }}
              >
                换一张
              </button>
            </div>
            {/* 读不出来也照样能记：表单就在下面，不把用户锁死在重试上 */}
            <div className="hint" style={{ marginTop: 10, textAlign: 'left', lineHeight: 1.6 }}>
              读数只能你自己对着屏幕填了。下面的表单已经打开，填完照样能保存。
            </div>
          </>
        )}

        {(phase === 'ready' || phase === 'error') && (
          <>
            {preview && <img className="shot" src={preview} alt="血压计屏幕" />}

            {warn && (
              <div className="alert" style={{ marginTop: 12 }}>
                {warn}
              </div>
            )}

            <div className="card" style={{ marginTop: 12 }}>
              <div className="flabel">读数（mmHg）</div>
              <div className="grid c3" style={{ marginTop: 6 }}>
                <label className="field">
                  <span>高压 SYS</span>
                  <NumInput value={sys} onValue={setSys} placeholder="126" ariaLabel="收缩压" />
                </label>
                <label className="field">
                  <span>低压 DIA</span>
                  <NumInput value={dia} onValue={setDia} placeholder="82" ariaLabel="舒张压" />
                </label>
                <label className="field">
                  <span>脉搏</span>
                  <NumInput value={pulse} onValue={setPulse} placeholder="选填" ariaLabel="脉搏" />
                </label>
              </div>

              {previewReading && tone && cat && (
                <div className="row" style={{ marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: TONE_VAR[tone] ?? 'var(--fg)', fontWeight: 'var(--fw-emphasis)' }}>
                    {BP_LABEL[cat]}
                  </span>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)' }}>
                    脉压差 {pulsePressure(previewReading)} mmHg
                  </span>
                </div>
              )}

              {!previewOk && checked.ok === false && (
                <div className="hint" style={{ marginTop: 8, color: 'var(--amber)' }}>
                  {checked.reason}
                </div>
              )}
            </div>

            {/* 心律不齐：模型在这件事上并不可靠（实测过：一个真实的心律不齐图标
                被它答成 false，等于替机器宣布"心律整齐"）。所以这条交给用户按一下，
                默认"没看清"= null —— 不许任何人替这条记录下结论。 */}
            <div className="card">
              <div className="row" style={{ alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--dim)' }}>屏幕上有心律不齐提示？</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {([
                    ['有', true],
                    ['没有', false],
                    ['没看清', null],
                  ] as const).map(([label, value]) => (
                    <button
                      key={String(value)}
                      onClick={() => setFlags((f) => ({ ...f, irregular: value }))}
                      style={chipStyle(flags.irregular === value)}
                      aria-label={`心律不齐：${label}`}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
              <div className="hint" style={{ marginTop: 6, textAlign: 'left', lineHeight: 1.5 }}>
                {flags.irregular === true
                  ? '这条会带上标记，导出来给医生看时有用。它不影响读数本身。'
                  : flags.irregular === false
                    ? '记为「这次没有」，这一条不会出现在心律不齐的统计里。'
                    : '模型认这个图标不太稳，这里默认不作判断。机器屏幕上闪了那个标记就点「有」。'}
              </div>
            </div>

            <div className="card">
              <label className="field">
                <span>测量时间</span>
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value);
                    // 手改过就不该再声称来源是 EXIF/文件名，UI 上的来源标签会跟着变
                    setTimeSource('user');
                  }}
                  aria-label="测量时间"
                />
              </label>
              <div className="hint" style={{ marginTop: 6, textAlign: 'left', lineHeight: 1.6 }}>
                来源：{TIME_SOURCE_LABEL[timeSource]}
                {crossDay && (
                  <>
                    {' · 会归到 '}
                    <b>{formatDayLabel(willArchiveAs, today)}</b>
                  </>
                )}
                {future && <> · <span style={{ color: 'var(--amber)' }}>比现在还晚</span></>}
              </div>
            </div>

            <div className="card">
              <label className="field">
                <span>设备型号（选填）</span>
                <input
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  placeholder="如：欧姆龙 HEM-7136"
                  maxLength={40}
                  aria-label="设备型号"
                />
              </label>
              <div style={{ height: 10 }} />
              <label className="field">
                <span>备注（选填）</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="如：晨起排尿后、静坐 5 分钟"
                  maxLength={80}
                  aria-label="备注"
                />
              </label>
            </div>

            {flags.raw.length > 0 && (
              <div className="hint" style={{ marginTop: 8, textAlign: 'left', lineHeight: 1.6, opacity: 0.75 }}>
                模型当时读到的原始片段：{flags.raw.join(' / ')}
                <br />
                这是不存照片情况下唯一的对证，用来区分「读错了」还是「机器就是这么显示的」。
              </div>
            )}

            {saveWarn && (
              <div className="alert error" style={{ marginTop: 12 }}>
                {saveWarn}
              </div>
            )}

            <div className="hint" style={{ marginTop: 14, textAlign: 'center' }}>
            </div>
          </>
        )}
      </div>
    </>
  );
}
