import { PERIOD_DAYS, WEIGHT_MA_DAYS } from '../../core/report/period';
import { Sparkline } from '../../ui/Sparkline';
import { PeriodNav } from '../../ui/PeriodNav';
import type { DietStatsResult } from './useDietStats';

const f0 = (n: number) => Math.round(n).toLocaleString();

/**
 * 饮食分区的面板。
 *
 * 只渲染 `<div className="main">` 里的内容：页头与分区切换由 StatsPage 持有。
 * 所有数字都来自 `useDietStats`，这里不碰数据库 —— 展示与取数分开之后，
 * 「统计页」这个壳才能同时挂两种完全不同的数据源。
 */
export function DietStats({ st }: { st: DietStatsResult }) {
  const v = st.view;
  if (!v) return null;

  const { goal, s, change, verdict, bars, maxBar, targetPct, dense } = v;

  /**
   * 柱图固定 96px 高（.chart-bars），虚线用 `bottom: targetPct%` 定位，
   * 所以从**顶部**量它是 `96 × (1 − targetPct/100)`。柱顶同理。
   * 这两个值只用来判断「数字带会不会撞上虚线带」，不参与布局。
   */
  const CHART_H = 96;
  const lineY = CHART_H * (1 - targetPct / 100);

  return (
    <>
      <PeriodNav kind={st.kind} offset={st.offset} label={st.range.label} onChange={st.setOffset} />

      <div className="card">
        <div className="title row">
          <span>{st.kind === 'quarter' ? '每 7 天日均热量' : '每日热量'}</span>
          <span style={{ fontSize: 'var(--fs-caption)' }}>虚线为目标 {f0(goal.kcal)}</span>
        </div>

        {bars.every((b) => b.kcal == null) ? (
          <div className="empty" style={{ padding: '14px 0' }}>这段时间还没有记录</div>
        ) : (
          <>
            <div className={`chart-bars${dense ? ' dense' : ''}`}>
              {bars.map((b) => (
                <div className="ccol" key={b.key}>
                  <div className="cbar-slot">
                    {/* role="img" + aria-label：这 30 根柱子以前是一排没有任何语义的 div，
                        读屏用户听到的是「每日热量 虚线为目标 1,902 近 7 天概览…」，
                        中间每一天的数值一个都拿不到。加上之后长按也能读出当天值。 */}
                    <div
                      className={`cbar${b.kcal == null ? ' none' : b.kcal > goal.kcal * 1.1 ? ' over' : ''}${b.kcal != null && b.kcal > maxBar ? ' clipped' : ''}`}
                      style={{ height: `${b.kcal == null ? 2 : Math.min(100, (b.kcal / maxBar) * 100)}%` }}
                      role="img"
                      aria-label={b.kcal == null
                        ? `${b.key.replace(/-/g, '/')} 没有记录`
                        : `${b.key.replace(/-/g, '/')} ${f0(b.kcal)} 千卡，目标 ${f0(goal.kcal)}${b.kcal > maxBar ? '，已超出纵轴上限于柱顶截断' : ''}`}
                    >
                      {/* 柱子数量少时直接标数字：都在目标线附近时，看高度分不出 1,880 和 2,010。
                          柱太矮就不标，否则数字会溢出到柱子外面。门槛 22 保持不变。

                          撞目标虚线要**两套机制**，缺一不可：
                          ① `.cval` z-index 3 > `.ctarget` 2 → 虚线不横穿笔画；
                          ② 但虚线外侧带着 1px 卡片色切缝（让线在柱面上分得出来），
                             奶油字（--bar-fg）落在奶油缝（--card）上只有 1.01:1，等于消失。
                             **层叠管谁盖谁，管不了"背景被换掉"** → 必须让路。
                          三段判据（数字带 4~16、带厚 12、两侧各留 1.5 余量）：
                          顶部可以 → 标顶部；顶部被切缝穿过 → 标柱底；两头都不行 → 不标。
                          虚线带是**非对称**的 [lineY-2, lineY+1]：1.5px 边框按像素取整后
                          实体在中心之上 1~2px、切缝在下方 1px，按对称 ±1.75 判会漏掉这种情况。 */}
                      {bars.length <= 8 && b.kcal != null
                        && (b.kcal / maxBar) * 100 >= 22 && (() => {
                        const barTop = CHART_H * (1 - Math.min(1, b.kcal! / maxBar));
                        const hit = (from: number, to: number) =>
                          lineY - 2 < to + 1.5 && lineY + 1 > from - 1.5;
                        const topHit = hit(barTop + 4, barTop + 16);
                        const botHit = hit(CHART_H - 16, CHART_H - 4);
                        if (topHit && botHit) return null;   // 柱子太矮，两头都被穿 → 不标
                        return (
                          <span className={`cval${topHit ? ' low' : ''}`}>{f0(b.kcal!)}</span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ))}
              <div className="ctarget" style={{ bottom: `${targetPct}%` }} />
            </div>
            <div className={`chart-lbs${dense ? ' dense' : ''}`}>
              {bars.map((b) => (
                <span key={b.key} className={b.isToday ? 'today' : undefined}>{b.label}</span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="title">近 {PERIOD_DAYS[st.kind]} 天概览</div>
        <div className="krow">
          <span className="k">平均每日摄入</span>
          <span className="v">
            {s.avgKcal == null ? '—' : f0(s.avgKcal)}
            <small>kcal</small>
          </span>
        </div>
        <div className="krow">
          <span className="k">与上一个 {PERIOD_DAYS[st.kind]} 天比</span>
          <span className="v">
            {v.deltaVsPrev == null ? '—' : `${v.deltaVsPrev > 0 ? '+' : ''}${f0(v.deltaVsPrev)}`}
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
      </div>

      <div className="card">
        <div className="title row">
          <span>理论 vs 实际</span>
          <span style={{ fontSize: 'var(--fs-caption)' }}>缺口 ÷ 7700 对照称重</span>
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
            <em>{change == null ? '需要两次以上称重' : `${change.points} 次称重 · ${change.method === 'ma' ? `${WEIGHT_MA_DAYS} 日均值` : '首末原始值'}`}</em>
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
          <span style={{ fontSize: 'var(--fs-caption)' }}>细点是称重 · 绿线是 {WEIGHT_MA_DAYS} 日均值</span>
        </div>
        <Sparkline points={v.points} target={goal.targetWeightKg} />
        {v.points.length > 0 && (
          <div className="krow" style={{ marginTop: 4 }}>
            <span className="k">最新（{WEIGHT_MA_DAYS} 日均）</span>
            <span className="v">
              {v.points[v.points.length - 1]!.ma?.toFixed(1)}
              <small>kg</small>
            </span>
          </div>
        )}
      </div>

      {s.microGaps.length > 0 && (
        <div className="card">
          <div className="title row">
            <span>长期缺口</span>
            <span style={{ fontSize: 'var(--fs-caption)' }}>日均低于目标 80% 才入榜</span>
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

      {s.weekday && s.weekend && v.weekendDiff != null && Math.abs(v.weekendDiff) >= 150 && (
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
              周末比工作日{v.weekendDiff > 0 ? '多' : '少'}吃 {f0(Math.abs(v.weekendDiff))} kcal
            </b>
            <p>
              按每月 8 个周末日算，一个月约 {v.weekendMonthKg!.toFixed(1)} kg 的差距。
              这类规律比任何通用建议都有用，处理办法是提前安排，而不是到周末再克制。
            </p>
          </div>
        </div>
      )}

      <div className="hint">
        所有数字都由记录推算，不是估算：理论变化 = 累计缺口 ÷ 7700，
        实际变化只取称重。两者对不上时，先怀疑记录，再怀疑身体。<br />
        统计窗口是滚动的最近 {PERIOD_DAYS[st.kind]} 天，随日期自动前移。
      </div>
    </>
  );
}
