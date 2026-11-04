export interface RingProps {
  value: number;
  target: number;
  size?: number;
}

export function Ring({ value, target, size = 186 }: RingProps) {
  const stroke = 13;
  const r = size / 2 - stroke / 2 - 3;
  const circ = 2 * Math.PI * r;
  const ratio = target > 0 ? value / target : 0;
  const pct = Math.max(0, Math.min(ratio, 1));
  const over = target > 0 && value > target;

  return (
    <div className="ringwrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/*
          渐变与轨道色**不能写死在这里**：stop-color / stroke 对 var() 的支持在旧 WebKit 上不齐，
          统一挪到 index.css 的类名上（.ring-*），深浅两套色板各给一份。
        */}
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className={over ? 'ring-over-a' : 'ring-a'} />
            <stop offset="1" className={over ? 'ring-over-b' : 'ring-b'} />
          </linearGradient>
        </defs>
        <circle
          className="ring-track"
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        />
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

          这里原本还有一行「还可摄入 1,190 kcal」，已删：
          今日页右上角那颗胶囊说的是同一件事（`剩 1190 kcal` / `超出 86 kcal`），
          同一屏两处报同一个缺口，用户会以为哪里对不上，而不是觉得信息充分。
          环里只留「已摄入 · 目标」—— 那是环本身的刻度，别处没有。
        */}
        <div className="ring-sub">
          <div className="unit">已摄入 · 目标 {Math.round(target).toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
