/**
 * 体重折线。
 *
 * 画两层：淡点是每次称重的原始值，实线是 30 日移动平均。
 * 只画原始值的话，一次吃咸了涨 0.8kg 就会被当成「方案没用」；
 * 只画平滑线又会让用户以为体重是平滑下降的。两层放在一起才看得懂。
 */

interface Props {
  points: { day: string; raw: number | null; ma: number | null }[];
  /** 目标体重，画一条虚线 */
  target?: number | null;
}

const W = 300;
/**
 * viewBox 高 92 → **104**，上下边距拆成 10 / 18。
 *
 * SVG 里没有「盒子」可以撑开：字号从 7px 抬到 12px（+71%）就是标签带 +71%。
 * 实测（4× 超采样像素扫描，产品字体栈）旧版会压进绘图区：
 *   · 数字日期标签：基线 `H − 2 = 90`，墨迹上沿 **80.75**，绘图区底 82 → 压 **1.25px**
 *   · CJK 标签（「目标 68」）：墨迹上沿 **80.0** → 压 **2.0px**
 * （`0.9 × 12` 是 em 盒估算，偏保守，别拿它当唯一论据；两个实测值都要留在这里，
 *   否则以后有人按更大的估算值认为「比实际更糟」，反而改错方向。）
 * 现在基线 `H − 4 = 100`、墨迹上沿 90.75，绘图区底 `104 − 18 = 86` → 让出 **4.75px**。
 * 这个 4.75px 是验收口径：BpChart 的 PAD_B 也必须让出同样的 4.75px。
 */
const H = 104;
const PAD_X = 6;
const PAD_Y_TOP = 10;
const PAD_Y_BOTTOM = 18;

export function Sparkline({ points, target = null }: Props) {
  if (points.length < 2) {
    return <div className="empty" style={{ padding: '14px 0' }}>至少需要两次称重才能画出趋势</div>;
  }

  const xs = points.map((p) => p.day);
  const t0 = new Date(`${xs[0]}T00:00:00`).getTime();
  const t1 = new Date(`${xs[xs.length - 1]}T00:00:00`).getTime();
  const span = Math.max(t1 - t0, 1);

  const vals: number[] = [];
  for (const p of points) {
    if (p.raw != null) vals.push(p.raw);
    if (p.ma != null) vals.push(p.ma);
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = Math.max((max - min) * 0.18, 0.35);
  const lo = min - pad;
  const hi = max + pad;
  const range = Math.max(hi - lo, 0.1);

  /**
   * 目标体重不参与纵轴范围。
   * 目标往往在 10kg 之外，把它塞进坐标域会把真实波动压成一条贴在顶部的直线 ——
   * 那样图就没有任何信息量了。落在范围内才画线，否则退化成一行文字说明。
   */
  const showTarget = target != null && target >= lo && target <= hi;
  const targetGap = target != null
    ? (points[points.length - 1]?.ma ?? points[points.length - 1]?.raw ?? 0) - target
    : null;

  const x = (day: string) =>
    PAD_X + ((new Date(`${day}T00:00:00`).getTime() - t0) / span) * (W - PAD_X * 2);
  const y = (v: number) => PAD_Y_TOP + (1 - (v - lo) / range) * (H - PAD_Y_TOP - PAD_Y_BOTTOM);

  const maPts = points.filter((p) => p.ma != null);
  const maPath = maPts.map((p) => `${x(p.day).toFixed(1)},${y(p.ma!).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="体重趋势">
      {showTarget && (
        <>
          <line
            x1={PAD_X} x2={W - PAD_X} y1={y(target!)} y2={y(target!)}
            stroke="var(--mute)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"
          />
          <text x={W - PAD_X} y={y(target!) - 3} textAnchor="end" className="spark-lb">
            目标 {target}
          </text>
        </>
      )}

      {points.filter((p) => p.raw != null).map((p) => (
        <circle key={p.day} cx={x(p.day)} cy={y(p.raw!)} r="1.9" fill="var(--dim)" opacity="0.55" />
      ))}

      <polyline
        points={maPath}
        fill="none"
        stroke="var(--green)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      <circle cx={x(last.day)} cy={y(last.ma ?? last.raw!)} r="3" fill="var(--green)" />
      <text
        x={Math.min(x(last.day), W - PAD_X - 22)}
        y={y(last.ma ?? last.raw!) - 10}
        textAnchor="middle"
        className="spark-val"
      >
        {(last.ma ?? last.raw)!.toFixed(1)}
      </text>

      {!showTarget && target != null && targetGap != null && (
        <text x={PAD_X} y={H - 4} className="spark-lb">
          目标 {target.toFixed(1)}kg · 还差 {Math.abs(targetGap).toFixed(1)}kg
        </text>
      )}
    </svg>
  );
}
