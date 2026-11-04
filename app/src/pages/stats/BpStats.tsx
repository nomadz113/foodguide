import { useNavigate } from 'react-router-dom';
import {
  BP_LABEL, BP_TARGET_DEFAULT, classify, pulsePressure, toneOf, type BpReading,
} from '../../core/bp/engine';
import { PERIOD_DAYS } from '../../core/report/period';
import { BP_SOURCE_LABEL } from '../../core/bp/entry';
import { TIME_SOURCE_LABEL } from '../../core/media/takenAt';
import { formatClock, formatDayLabel } from '../../core/date';
import { IconClock } from '../../ui/icons';
import type { BpEntry } from '../../core/db/types';
import { useAppData } from '../../store/AppData';
import { TONE_VAR, toneIcon } from '../../ui/bpTone';
import { BpChart } from '../../ui/BpChart';
import { PeriodNav } from '../../ui/PeriodNav';
import type { BpStatsResult } from './useBpStats';

/**
 * 血压分区的面板。
 *
 * 只渲染 `<div className="main">` 里的内容：头部（h1 / 摘要 / 周月季）与分区切换
 * 由 StatsPage 统一持有，否则两个分区会各自画一套间距不一致的页头。
 */
export function BpStats({ st }: { st: BpStatsResult }) {
  const { today } = useAppData();
  const nav = useNavigate();
  const v = st.view;
  if (!v) return null;

  const { s } = v;
  const kind = st.kind;
  const range = st.range;

  return (
    <>
      <PeriodNav kind={kind} offset={st.offset} label={range.label} onChange={st.setOffset} />

      <div className="card">
        <div className="title row">
          <span>{v.groupSize > 1 ? '每 7 天平均' : '每日平均'}</span>
          <span style={{ fontSize: 'var(--fs-caption)' }}>
            {v.ma.length > 0 ? '实线为 7 日移动平均' : '虚线为达标上限'}
          </span>
        </div>
        <BpChart points={v.points} ma={v.ma} target={BP_TARGET_DEFAULT} />
        <div className="row" style={{ justifyContent: 'center', gap: 14, marginTop: 4 }}>
          <Legend color="var(--purple)" text="收缩压（高压）" />
          <Legend color="var(--cyan)" text="舒张压（低压）" />
        </div>
      </div>

      {/* 「最近一次」紧跟趋势图：先看走势，再看现在是多少。
          它原先排在两个按钮之后，前面隔着晨晚卡，一进页面根本扫不到；
          而这条恰恰是最该被看到的数字。 */}
      {v.latest && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row">
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)' }}>
              {formatDayLabel(v.latest.date, today)} {formatClock(v.latest.measuredAt)}
            </span>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)' }}>
              脉压差 {pulsePressure(v.latest)} mmHg
              {v.latest.pulse != null ? ` · 脉搏 ${v.latest.pulse}` : ''}
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            <ReadingLine bp={v.latest} />
          </div>
          <div style={{ marginTop: 8, fontSize: 'var(--fs-caption)', color: 'var(--mute)', lineHeight: 1.6 }}>
            时间来源：{TIME_SOURCE_LABEL[v.latest.timeSource]} · {BP_SOURCE_LABEL[v.latest.source]}
            {v.latest.flags?.irregular === true ? ' · 这次有心律不齐标记' : ''}
            {v.latest.device ? ` · ${v.latest.device}` : ''}
            {v.latest.note ? ` · ${v.latest.note}` : ''}
          </div>
        </div>
      )}

      {s.recordedDays > 0 ? (
        <>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="title row">
              <span>这段时间</span>
              <span style={{ fontSize: 'var(--fs-caption)' }}>{range.label}</span>
            </div>
            <div className="krow">
              <span className="k">平均</span>
              <span className="v">
                <Reading r={s.mean} />
                {v.prevMeanDelta != null && (
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)', marginLeft: 6 }}>
                    较上一个 {PERIOD_DAYS[kind]} 天 {v.prevMeanDelta > 0 ? '+' : ''}{v.prevMeanDelta}
                  </span>
                )}
              </span>
            </div>
            <div className="krow">
              <span className="k">达标天数</span>
              <span className="v">
                {v.targetRate != null
                  ? `${Math.round(v.targetRate * 100)}%（${s.onTargetDays}/${s.recordedDays} 天）`
                  : '—'}
              </span>
            </div>
            <div className="krow">
              <span className="k">最高 / 最低</span>
              <span className="v">
                {s.highest && s.lowest
                  ? `${s.highest.systolic}/${s.highest.diastolic} · ${s.lowest.systolic}/${s.lowest.diastolic}`
                  : '—'}
              </span>
            </div>
            <div className="krow">
              <span className="k">记录连续</span>
              <span className="v">{v.streak > 0 ? `连续 ${v.streak} 天` : '已中断'}</span>
            </div>
            <div className="hint" style={{ marginTop: 8, fontSize: 'var(--fs-caption)' }}>
              达标线 {BP_TARGET_DEFAULT.systolic}/{BP_TARGET_DEFAULT.diastolic} mmHg；
              一天多次测量先取当天平均值再判定，测得多不会让达标率变低。
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="title row">
              <span>晨峰 / 晚峰</span>
              <span style={{ fontSize: 'var(--fs-caption)' }}>6–10 点 vs 18–22 点</span>
            </div>
            <div className="krow">
              <span className="k">晨 6–10 点</span>
              <span className="v">
                <Reading r={s.morningMean} />
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)', marginLeft: 6 }}>
                  {s.morningCount} 次
                </span>
              </span>
            </div>
            <div className="krow">
              <span className="k">晚 18–22 点</span>
              <span className="v">
                <Reading r={s.eveningMean} />
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)', marginLeft: 6 }}>
                  {s.eveningCount} 次
                </span>
              </span>
            </div>
            {/* 样本不足时只陈述，不下结论：3 次以内的差值基本是噪声，
                说成「你的血压夜间偏高」等于给用户一个没有依据的判断 */}
            <div className="hint" style={{ marginTop: 8, fontSize: 'var(--fs-caption)' }}>
              {s.windowComparable
                ? '晨晚两侧样本都够，可以参考两者的差值变化。'
                : '晨、晚各至少需要 3 次记录才能比较，现在样本还不够。'}
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty">
            <span className="ic"><IconClock size={26} /></span>
            这段时间还没有血压记录。
            <br />
            往回翻一个窗口，或者现在记一次。
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="pill ok" style={{ flex: 1, height: 44 }} onClick={() => nav('/bp/capture')}>
          拍照识别
        </button>
        <button className="pill" style={{ flex: 1, height: 44 }} onClick={() => nav('/bp/manual')}>
          手动输入
        </button>
      </div>

      {v.rows.length > 0 && (
        <div className="card" style={{ marginTop: 14, padding: 0, background: 'none', border: 0 }}>
          <div className="title row" style={{ padding: '0 2px', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--dim)', fontWeight: 'var(--fw-emphasis)' }}>
              本窗口内的记录
            </span>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)' }}>{v.rows.length} 条</span>
          </div>

          {[...v.rows].reverse().map((bp) => {
            const tone = toneOf(bp);
            return (
              <div className="meal" key={bp.id}>
                <div
                  className="thumb"
                  style={{ color: TONE_VAR[tone], fontSize: 13, fontWeight: 'var(--fw-emphasis)' }}
                >
                  ♥
                </div>
                <div className="info">
                  <div className="n" style={{ color: TONE_VAR[tone] }}>
                    <b>
                      {bp.systolic}/{bp.diastolic}
                    </b>
                    <span style={{ color: 'var(--mute)', fontSize: 'var(--fs-caption)', marginLeft: 6 }}>
                      {BP_LABEL[classify(bp)]}
                    </span>
                  </div>
                  <div className="d">
                    {formatDayLabel(bp.date, today)} {formatClock(bp.measuredAt)}
                    {bp.pulse != null ? ` · 脉搏 ${bp.pulse}` : ''}
                    {' · '}
                    {BP_SOURCE_LABEL[bp.source]}
                    {bp.flags?.irregular === true ? ' · 心律不齐标记' : ''}
                    {bp.flags?.avg === true ? ' · 平均值' : ''}
                  </div>
                </div>
                <div className="kcal">
                  <b style={{ fontSize: 12 }}>
                    {bp.timeSource === 'user' ? '手改' : TIME_SOURCE_LABEL[bp.timeSource].slice(0, 6)}
                  </b>
                  <span>来源</span>
                </div>
                <button className="del" aria-label="删除" onClick={() => void st.remove(bp)}>×</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="hint" style={{ marginTop: 14, lineHeight: 1.6 }}>
        这里只记录，不构成诊断。读数持续 ≥140/90 或明显不适，请去医院，
        <br />
        不要根据这个 App 的建议调整用药。
      </div>
    </>
  );
}

function ReadingLine({ bp }: { bp: BpEntry }) {
  const tone = toneOf(bp);
  const cat = classify(bp);
  return (
    <div className="row" style={{ alignItems: 'baseline' }}>
      <div>
        <b
          style={{
            fontSize: 26,
            fontWeight: 'var(--fw-emphasis)',
            letterSpacing: '-0.02em',
            color: TONE_VAR[tone],
          }}
        >
          {toneIcon(tone)}
          {bp.systolic}/{bp.diastolic}
        </b>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)', marginLeft: 6 }}>mmHg</span>
      </div>
      <span style={{ fontSize: 'var(--fs-caption)', color: TONE_VAR[tone], fontWeight: 'var(--fw-emphasis)' }}>{BP_LABEL[cat]}</span>
    </div>
  );
}

function Reading({ r }: { r: BpReading | null }) {
  if (!r) return <b style={{ fontSize: 15 }}>—</b>;
  return <b style={{ fontSize: 15 }}>{r.systolic}/{r.diastolic}</b>;
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)' }}>
      <span
        style={{
          display: 'inline-block', width: 11, height: 2.5, borderRadius: 'var(--radius-pill)',
          background: color, marginRight: 5, verticalAlign: 'middle',
        }}
      />
      {text}
    </span>
  );
}
