export interface RingProps {
  value: number;
  target: number;
  size?: number;
  /** 环缺口文案的自由度：超出目标时自动切红 */
  showRemain?: boolean;
}

export function Ring({ value, target, size = 186, showRemain = true }: RingProps) {
  const stroke = 13;
  const r = size / 2 - stroke / 2 - 3;
  const circ = 2 * Math.PI * r;
  const ratio = target > 0 ? value / target : 0;
  const pct = Math.max(0, Math.min(ratio, 1));
  const remain = Math.round(target - value);
  const over = remain < 0;

  return (
    <div className="ringwrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={over ? '#fbbf24' : '#4ade80'} />
            <stop offset="1" stopColor={over ? '#f87171' : '#22d3ee'} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1c2531" strokeWidth={stroke} />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset .5s ease' }}
          />
        )}
      </svg>

      <div className="ring-center">
        <div className="big">{Math.round(value).toLocaleString()}</div>
        {/*
          副标题用绝对定位挂在数字下面，**不占高度**。
          否则「数字 + 两行小字」会作为一个整体被居中，数字就被顶到圆心上方去了 ——
          用户看的是数字在不在圆心，不是整个文字块在不在圆心。
        */}
        <div className="ring-sub">
          <div className="unit">已摄入 · 目标 {Math.round(target).toLocaleString()}</div>
          {showRemain && (
            <div className="left">
              {over ? '已超出 ' : '还可摄入 '}
              <b className={over ? 'over' : ''}>{Math.abs(remain).toLocaleString()}</b>
              <span> kcal</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
