/**
 * 血压趋势图：收缩压 / 舒张压两条线。
 *
 * 两个和体重图反着来的决定，都是被真实数据逼出来的：
 *
 * 1. **目标线必须纳入纵轴**。体重图刻意排除目标体重（目标常在 10kg 之外，塞进来会把
 *    真实波动压成一条贴顶的直线）；而血压的达标线 140/90 本来就落在读数中间，
 *    排除它，图上就再也看不出「离达标还差多少」—— 那是血压图唯一要紧的信息。
 * 2. **没有数据的日子必须断开**。见 trend.ts 的 splitGaps：跨过空缺连出来的线段是
 *    凭空生成的，用户会当成真实趋势读。这里对每段连续数据各画一条 polyline。
 *
 * 线色用 --purple / --cyan 而不是红/绿：红绿已经在 TONE_VAR 里表示「分级好坏」，
 * 同一张图再用一次，用户会以为线的颜色本身也有诊断含义。
 */

import { splitGaps, type BpPoint } from '../core/bp/trend';
import type { BpReading, BpTarget } from '../core/bp/engine';

interface Props {
  points: BpPoint[];
  /** 移动平均，与 points 等长；没给或全为 null 时直接连原始数据 */
  ma?: (BpReading | null)[];
  target: BpTarget;
}

const W = 320;
const H = 132;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
/**
 * 16 → 18，理由是**两张图必须同一个数**，不是「原来太挤」。
 *
 * 实测（4× 超采样像素扫描，产品字体栈）：PAD_B=16 时日期轴标签墨迹上沿到绘图区底
 * 让出 **2.75px**（1.2px 是 em 盒估算，不是墨迹，别拿它当论据）；而体重图
 * （Sparkline，PAD_Y_BOTTOM=18）让出 **4.75px** —— 两张图差 2px，真机并排看得出。
 * 改成 18 后绘图区底 114、让出 4.75px，与体重图完全相等，顺带多 1px 绘图高度。
 */
const PAD_B = 18;

const SYS_VAR = 'var(--purple)';
const DIA_VAR = 'var(--cyan)';

export function BpChart({ points, ma = [], target }: Props) {
  const vals: number[] = [];
  for (const p of points) {
    if (p.reading) vals.push(p.reading.systolic, p.reading.diastolic);
  }
  for (const m of ma) {
    if (m) vals.push(m.systolic, m.diastolic);
  }
  if (vals.length === 0) {
    return <div className="empty" style={{ padding: '18px 0' }}>这段时间还没有血压记录</div>;
  }

  // 目标纳入坐标域：读数与 140/90 的相对位置就是这张图的意义
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const min = Math.min(rawMin, target.diastolic);
  const max = Math.max(rawMax, target.systolic);
  const pad = Math.max(3, (max - min) * 0.1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const span = Math.max(hi - lo, 1);

  const n = points.length;
  const innerW = W - PAD_L - PAD_R;
  const x = (i: number) => (n <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (n - 1)) * innerW);
  const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B);

  const sysVals = points.map((p) => p.reading?.systolic ?? null);
  const diaVals = points.map((p) => p.reading?.diastolic ?? null);
  const maSys = ma.map((m) => m?.systolic ?? null);
  const maDia = ma.map((m) => m?.diastolic ?? null);
  const hasMa = maSys.some((v) => v != null);

  const lineSys = hasMa ? maSys : sysVals;
  const lineDia = hasMa ? maDia : diaVals;

  /** 一段 polyline 的 points 串：段与段之间不相连，空缺处就是断开的 */
  const path = (series: (number | null)[]) =>
    splitGaps(series).map((seg) =>
      seg.pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '),
    );


  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="血压趋势">
      {/* 超过收缩压目标的那一片区域铺一层底色：线有没有越线一眼能看出来 */}
      {target.systolic < hi && (
        <rect
          x={PAD_L} y={PAD_T} width={innerW}
          height={Math.max(0, y(target.systolic) - PAD_T)}
          fill="var(--warn-bg)"
        />
      )}

      {target.systolic > lo && target.systolic < hi && (
        <>
          <line
            x1={PAD_L} x2={W - PAD_R} y1={y(target.systolic)} y2={y(target.systolic)}
            stroke={SYS_VAR} strokeWidth="1" strokeDasharray="3 3" opacity="0.72"
          />
          {/* 颜色必须走 style 而不是 fill 属性：CSS 类 .spark-lb 带了 fill，
              presentation attribute 的优先级低于样式规则，写 fill 会被它顶掉 */}
          <text
            x={PAD_L + 2} y={y(target.systolic) - 4.5}
            className="spark-lb" style={{ fill: SYS_VAR }}
          >
            {target.systolic}
          </text>
        </>
      )}
      {target.diastolic > lo && target.diastolic < hi && (
        <>
          <line
            x1={PAD_L} x2={W - PAD_R} y1={y(target.diastolic)} y2={y(target.diastolic)}
            stroke={DIA_VAR} strokeWidth="1" strokeDasharray="3 3" opacity="0.72"
          />
          <text
            x={PAD_L + 2} y={y(target.diastolic) - 4.5}
            className="spark-lb" style={{ fill: DIA_VAR }}
          >
            {target.diastolic}
          </text>
        </>
      )}

      {/* 原始点始终画：只看平滑线不知道数据有多散，只看点看不出方向 */}
      {diaVals.map((v, i) =>
        v == null ? null : (
          <circle key={`d${points[i]!.key}`} cx={x(i)} cy={y(v)} r="2.2" fill={DIA_VAR} opacity="0.6" />
        ),
      )}
      {sysVals.map((v, i) =>
        v == null ? null : (
          <circle key={`s${points[i]!.key}`} cx={x(i)} cy={y(v)} r="2.2" fill={SYS_VAR} opacity="0.6" />
        ),
      )}

      {path(lineDia).map((d, k) => (
        <polyline
          key={`ld${k}`} points={d} fill="none" stroke={DIA_VAR}
          strokeWidth={hasMa ? 2.2 : 1.8} strokeLinejoin="round" strokeLinecap="round"
        />
      ))}
      {path(lineSys).map((d, k) => (
        <polyline
          key={`ls${k}`} points={d} fill="none" stroke={SYS_VAR}
          strokeWidth={hasMa ? 2.2 : 1.8} strokeLinejoin="round" strokeLinecap="round"
        />
      ))}

      {/* 这里刻意**不**在最后一个点上标数字：图上同时有两条线、两个目标刻度、三个日期标签，
          右上角必然打架；而且具体读数在下方「本期最后一次」卡片里本来就有，重复一次没增加信息 */}

      {/* X 轴只标首、中、尾三个日期，全标会糊成一条 */}
      {n >= 2 && (
        <>
          <text x={PAD_L} y={H - 4} className="spark-lb">{points[0]!.label}</text>
          {n >= 3 && (
            <text x={x(Math.floor((n - 1) / 2))} y={H - 4} textAnchor="middle" className="spark-lb">
              {points[Math.floor((n - 1) / 2)]!.label}
            </text>
          )}
          <text x={W - PAD_R} y={H - 4} textAnchor="end" className="spark-lb">
            {points[n - 1]!.label}
          </text>
        </>
      )}
    </svg>
  );
}
