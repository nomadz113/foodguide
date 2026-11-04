import type { PeriodKind } from '../core/report/period';

/**
 * 周 / 月 / 季 的胶囊切换。
 *
 * 抽出来的唯一理由是「统计」页里两个分区都要用它，而且**必须长得一模一样** ——
 * 它在两边的语义完全相同（切窗口长度），一旦有粗细或宽度差异，
 * 用户会以为它们控制的东西不一样。所以 KINDS 与 width 都只有这一份。
 */
const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
];

export function PeriodSeg({
  kind,
  onChange,
  className = 'seg',
  style,
  label,
}: {
  kind: PeriodKind;
  onChange: (k: PeriodKind) => void;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  return (
    <div
      className={className}
      style={style}
      role="group"
      aria-label={label ?? '统计窗口'}
    >
      {KINDS.map((k) => (
        <button
          key={k.key}
          className={kind === k.key ? 'on' : ''}
          aria-pressed={kind === k.key}
          onClick={() => onChange(k.key)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

/** 右上角那个窄胶囊的宽度。两边共用，改这里就同时改了两处 */
export const SEG_WIDTH = 132;
