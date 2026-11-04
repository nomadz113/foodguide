import type { NutritionFacts } from '../core/nutrition/types';
import type { MealItem } from '../core/db/types';
import { barWidth, fmtMineral, fmtPct, mealMinerals } from '../core/nutrition/minerals';

export interface MealMineralsProps {
  items: MealItem[];
  /** 全天微量目标，来自 GoalSnapshot.micro */
  targets: Partial<NutritionFacts>;
}

/**
 * 「这一餐的矿物质」汇总卡。
 *
 * 为什么不做成首页那种 14 格 MicroGrid：那个网格是 7 列的，这里只有 6 项矿物质
 * 且要带进度条与占比，塞进去会挤成一排看不见字的小方块。
 * 类名也因此用 .mgrid6 而**不是复用 .mgrid** —— 改 .mgrid 的列数会把首页排乱。
 */
export function MealMinerals({ items, targets }: MealMineralsProps) {
  if (items.length === 0) return null;
  const s = mealMinerals(items, targets);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="title row">
        <span>这一餐的矿物质</span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--mute)' }}>
          {s.itemsWithData} / {s.itemCount} 项有数据
        </span>
      </div>

      <div className="mgrid6">
        {s.cells.map((c) => {
          if (c.value == null) {
            return (
              <div className="mtile na" key={c.key}>
                <span className="mn">{c.label}</span>
                <span className="mv">—</span>
                <span className="mp">库里没有</span>
              </div>
            );
          }
          return (
            <div className="mtile" key={c.key}>
              <span className="mn">{c.label}</span>
              <span className="mv">
                {fmtMineral(c.value)}
                <small>{c.unit}</small>
              </span>
              <span className="mp">{fmtPct(c.pct)}</span>
              <span className="bar">
                <b style={{ width: `${barWidth(c.pct)}%` }} />
              </span>
            </div>
          );
        })}
      </div>

      {/* 左对齐而不是居中：这是一段解释，不是一行状态提示，
          居中会把最后几个字甩到第三行正中，读起来像断了一半 */}
      <div className="hint" style={{ marginTop: 10, fontSize: 'var(--fs-caption)', lineHeight: 1.6, textAlign: 'left' }}>
        微量取自食物库参考值，生熟未折算
        {s.partial ? '，还有食材没匹配上库' : ''}
        ，实际只会更高 —— 这里给的是下限。
      </div>
    </div>
  );
}
