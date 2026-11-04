import { PERIOD_DAYS, type PeriodKind } from '../core/report/period';

/**
 * 「‹ 前 N 天 ｜ 窗口标签 ｜ 后 N 天 ›」。
 *
 * offset 的语义由 periodRange 定义：0 = 截至今天，每 +1 整段前移 N 天。
 * 「后」按钮在 offset 已经是 0 时必须 disabled —— 允许它变负，
 * 窗口末端就跑到今天之后，未来日会被当成「没记录」，图上凭空多出几根空柱。
 */
export function PeriodNav({
  kind,
  offset,
  label,
  onChange,
}: {
  kind: PeriodKind;
  offset: number;
  label: string;
  onChange: (next: number) => void;
}) {
  const days = PERIOD_DAYS[kind];
  return (
    <div className="period-nav">
      <button onClick={() => onChange(offset + 1)}>‹ 前 {days} 天</button>
      <span>{label}</span>
      <button disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - 1))}>
        后 {days} 天 ›
      </button>
    </div>
  );
}
