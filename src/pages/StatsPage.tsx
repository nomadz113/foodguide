import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, diffDays } from '../core/date';
import { allGoals, mealsInRange, weightsInRange } from '../core/db/repo';
import {
  makeGoalResolver, periodRange, previousRange, smoothWeights, summarise, weightChange,
  type PeriodKind, type PeriodSummary,
} from '../core/report/period';
import { judge } from '../core/report/verdict';
import { useAppData } from '../store/AppData';
import { Sparkline } from '../ui/Sparkline';

const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
];

const f0 = (n: number) => Math.round(n).toLocaleString();

interface Bar {
  key: string;
  label: string;
  kcal: number | null;
  /** 该柱覆盖的天数（月/季按周聚合） */
  days: number;
}

/**
 * 月/季按「周」聚合而不是画 30/90 根柱子。
 * 90 根柱子在 390px 宽度下每根不到 4px，看不出任何形状，只能看出噪音。
 */
function buildBars(s: PeriodSummary, kind: PeriodKind): Bar[] {
  if (kind === 'week') {
    return s.days.map((d) => ({
      key: d.day,
      label: String(Number(d.day.slice(8))),
      kcal: d.recorded ? d.kcal : null,
      days: 1,
    }));
  }

  const groups = new Map<string, { label: string; sum: number; n: number }>();
  for (const d of s.days) {
    if (!d.recorded) continue;
    const dow = new Date(`${d.day}T00:00:00`).getDay();
    const start = addDays(d.day, -((dow === 0 ? 6 : dow - 1)));
    const g = groups.get(start) ?? {
      label: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`,
      sum: 0,
      n: 0,
    };
    g.sum += d.kcal;
    g.n += 1;
    groups.set(start, g);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([start, g]) => ({
      key: start,
      label: g.label,
      kcal: g.n > 0 ? g.sum / g.n : null,
      days: g.n,
    }));
}

export function StatsPage() {
  const { goal, profile, today } = useAppData();
  const [kind, setKind] = useState<PeriodKind>('week');
  const [anchor, setAnchor] = useState(today);

  // 切日（凌晨 4 点后）时回到今天，避免停留在过去的周期
  useEffect(() => { setAnchor(today); }, [today]);

  const range = periodRange(kind, anchor, today);
  const prev = previousRange(kind, range.from, today);

  const data = useLiveQuery(async () => {
    const [meals, prevMeals, goals, weights] = await Promise.all([
      mealsInRange(range.from, range.to),
      mealsInRange(prev.from, prev.to),
      allGoals(),
      // 多取 7 天：移动平均在周期第一天需要用前几天的称重
      weightsInRange(addDays(range.from, -7), range.to),
    ]);
    return { meals, prevMeals, goals, weights };
  }, [range.from, range.to, prev.from, prev.to]);

  const goalOf = useMemo(() => makeGoalResolver(data?.goals ?? [], goal), [data?.goals, goal]);

  if (!data) return <div className="main center">读取中…</div>;

  const s = summarise(range, data.meals, goalOf);
  const p = summarise(prev, data.prevMeals, goalOf);
  const end = range.to > today ? today : range.to;
  const change = weightChange(data.weights, range.from, end);
  const points = smoothWeights(data.weights)
    .filter((x) => x.day >= range.from && x.day <= end);

  const verdict = judge({
    theoryKg: s.theoryKg,
    actualKg: change?.deltaKg ?? null,
    coverage: s.coverage,
    elapsedDays: s.elapsedDays,
    goalType: profile.goalType,
    proteinHitRate: s.recordedDays > 0 ? s.proteinHitDays / s.recordedDays : undefined,
  });

  const bars = buildBars(s, kind);
  const maxBar = Math.max(goal.kcal * 1.15, ...bars.map((b) => b.kcal ?? 0), 1);
  const targetPct = (goal.kcal / maxBar) * 100;

  const canGoForward = range.to < today;

  const deltaVsPrev = s.avgKcal != null && p.avgKcal != null
    ? s.avgKcal - p.avgKcal
    : null;

  /** 周末规律的量化：每周 2 天、每月约 8 天，按 7700 kcal/kg 折算 */
  const weekendDiff = s.weekday && s.weekend ? s.weekend.avgKcal - s.weekday.avgKcal : null;
  const weekendMonthKg = weekendDiff == null ? null : (Math.abs(weekendDiff) * 8) / 7700;

  return (
    <>
      <div className="hdr">
        <div>
          <h1>进度</h1>
          <div className="sub">
            记录 {s.recordedDays}/{s.elapsedDays} 天
            {s.avgKcal != null && ` · 日均 ${f0(s.avgKcal)} kcal`}
          </div>
        </div>
        <div className="seg" style={{ width: 132 }}>
          {KINDS.map((k) => (
            <button
              key={k.key}
              className={kind === k.key ? 'on' : ''}
              onClick={() => { setKind(k.key); setAnchor(today); }}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="main">
        <div className="period-nav">
          <button onClick={() => setAnchor(addDays(range.from, -1))}>‹ 上一{kind === 'week' ? '周' : kind === 'month' ? '月' : '季'}</button>
          <span>{range.label}</span>
          <button disabled={!canGoForward} onClick={() => setAnchor(addDays(range.to, 1))}>
            下一{kind === 'week' ? '周' : kind === 'month' ? '月' : '季'} ›
          </button>
        </div>

        <div className="card">
          <div className="title row">
            <span>{kind === 'week' ? '每日热量' : '每周日均热量'}</span>
            <span style={{ fontSize: 10 }}>虚线为目标 {f0(goal.kcal)}</span>
          </div>

          {bars.every((b) => b.kcal == null) ? (
            <div className="empty" style={{ padding: '14px 0' }}>这个周期还没有记录</div>
          ) : (
            <>
              <div className="chart-bars">
                {bars.map((b) => (
                  <div className="ccol" key={b.key}>
                    <div className="cbar-slot">
                      <div
                        className={`cbar${b.kcal == null ? ' none' : b.kcal > goal.kcal * 1.1 ? ' over' : ''}`}
                        style={{ height: `${b.kcal == null ? 2 : (b.kcal / maxBar) * 100}%` }}
                      >
                        {/* 柱子数量少时直接标数字：都在目标线附近时，看高度分不出 1,880 和 2,010。
                            柱太矮就不标，否则数字会溢出到柱子外面 */}
                        {bars.length <= 8 && b.kcal != null
                          && (b.kcal / maxBar) * 100 >= 22 && (
                          <span className="cval">{f0(b.kcal)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="ctarget" style={{ bottom: `${targetPct}%` }} />
              </div>
              <div className="chart-lbs">
                {bars.map((b) => <span key={b.key}>{b.label}</span>)}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="title">本{kind === 'week' ? '周' : kind === 'month' ? '月' : '季'}概览</div>
          <div className="krow">
            <span className="k">平均每日摄入</span>
            <span className="v">
              {s.avgKcal == null ? '—' : f0(s.avgKcal)}
              <small>kcal</small>
            </span>
          </div>
          <div className="krow">
            <span className="k">与上个周期比</span>
            <span className="v">
              {deltaVsPrev == null ? '—' : `${deltaVsPrev > 0 ? '+' : ''}${f0(deltaVsPrev)}`}
              <small>kcal/天</small>
            </span>
          </div>
          <div className="krow">
            <span className="k">热量达标（±10%）</span>
            <span className="v">{s.onTargetDays}<small>/ {s.recordedDays} 天</small></span>
          </div>
          <div className="krow">
            <span className="k">蛋白达标</span>
            <span className="v" style={{ color: s.recordedDays > 0 && s.proteinHitDays / s.recordedDays >= 0.6 ? 'var(--green)' : 'var(--amber)' }}>
              {s.proteinHitDays}<small>/ {s.recordedDays} 天</small>
            </span>
          </div>
          <div className="krow">
            <span className="k">平均钠（上限 2000mg）</span>
            <span className="v" style={{ color: s.sodiumOverDays > 0 ? 'var(--amber)' : undefined }}>
              {s.avgSodium == null ? '—' : f0(s.avgSodium)}
              <small>mg{s.sodiumOverDays > 0 ? ` · 超 ${s.sodiumOverDays} 天` : ''}</small>
            </span>
          </div>
        </div>

        <div className="card">
          <div className="title row">
            <span>理论 vs 实际</span>
            <span style={{ fontSize: 10 }}>缺口 ÷ 7700 对照称重</span>
          </div>

          <div className="tv-row">
            <div className="tv-cell">
              <span>理论变化</span>
              <b style={{ color: s.theoryKg == null ? undefined : s.theoryKg < -0.05 ? 'var(--green)' : s.theoryKg > 0.05 ? 'var(--amber)' : undefined }}>
                {s.theoryKg == null ? '—' : Math.abs(s.theoryKg) < 0.05 ? '0.0' : `${s.theoryKg > 0 ? '+' : ''}${s.theoryKg.toFixed(1)}`}
                <i>kg</i>
              </b>
              <em>按累计缺口 {s.totalDeficit == null ? '—' : f0(s.totalDeficit)} kcal</em>
            </div>
            <div className="tv-cell">
              <span>实际变化</span>
              <b style={{ color: change == null ? undefined : change.deltaKg < -0.05 ? 'var(--green)' : change.deltaKg > 0.05 ? 'var(--amber)' : undefined }}>
                {change == null ? '—' : Math.abs(change.deltaKg) < 0.05 ? '0.0' : `${change.deltaKg > 0 ? '+' : ''}${change.deltaKg.toFixed(1)}`}
                <i>kg</i>
              </b>
              <em>{change == null ? '需要两次以上称重' : `${change.points} 次称重 · ${change.method === 'ma' ? '7 日均值' : '首末原始值'}`}</em>
            </div>
          </div>

          <div className={`verdict ${verdict.tone}`}>
            <b>{verdict.headline}</b>
            <p>{verdict.body}</p>
          </div>
        </div>

        <div className="card">
          <div className="title row">
            <span>体重趋势</span>
            <span style={{ fontSize: 10 }}>细点是称重 · 绿线是 7 日均值</span>
          </div>
          <Sparkline points={points} target={goal.targetWeightKg} />
          {points.length > 0 && (
            <div className="krow" style={{ marginTop: 4 }}>
              <span className="k">最新（7 日均）</span>
              <span className="v">
                {points[points.length - 1]!.ma?.toFixed(1)}
                <small>kg</small>
              </span>
            </div>
          )}
        </div>

        {s.microGaps.length > 0 && (
          <div className="card">
            <div className="title row">
              <span>长期缺口</span>
              <span style={{ fontSize: 10 }}>日均低于目标 80% 才入榜</span>
            </div>
            {s.microGaps.map((g) => (
              <div className="gaprow" key={g.key}>
                <div className="gap-hd">
                  <span className="k">{g.label}</span>
                  <span className="v">
                    {g.avg < 10 ? g.avg.toFixed(1) : f0(g.avg)}
                    <small> / {f0(g.target)}（{Math.round(g.ratio * 100)}%）</small>
                  </span>
                </div>
                <div className="gap-track">
                  <div className="gap-fill" style={{ width: `${Math.min(g.ratio, 1) * 100}%` }} />
                </div>
                <div className="gap-note">基于 {g.days} 天的可靠数据</div>
              </div>
            ))}
            <div className="hint" style={{ textAlign: 'left', marginTop: 8 }}>
              微量来自食物库匹配，没匹配上的项不计入，所以这里只会漏报、不会误报。
            </div>
          </div>
        )}

        {s.weekday && s.weekend && weekendDiff != null && Math.abs(weekendDiff) >= 150 && (
          <div className="card">
            <div className="title">规律</div>
            <div className="krow">
              <span className="k">工作日日均</span>
              <span className="v">{f0(s.weekday.avgKcal)}<small>kcal · {s.weekday.days} 天</small></span>
            </div>
            <div className="krow">
              <span className="k">周末日均</span>
              <span className="v">{f0(s.weekend.avgKcal)}<small>kcal · {s.weekend.days} 天</small></span>
            </div>
            <div className="verdict warn" style={{ marginTop: 8 }}>
              <b>
                周末比工作日{weekendDiff > 0 ? '多' : '少'}吃 {f0(Math.abs(weekendDiff))} kcal
              </b>
              <p>
                按每月 8 个周末日算，一个月约 {weekendMonthKg!.toFixed(1)} kg 的差距。
                这类规律比任何通用建议都有用，处理办法是提前安排，而不是到周末再克制。
              </p>
            </div>
          </div>
        )}

        <div className="hint">
          所有数字都由记录推算，不是估算：理论变化 = 累计缺口 ÷ 7700，
          实际变化只取称重。两者对不上时，先怀疑记录，再怀疑身体。<br />
          {kind === 'week' && diffDays(range.from, today) < 6 && '本周尚未结束，结论只代表已过去的天数。'}
        </div>
      </div>
    </>
  );
}
