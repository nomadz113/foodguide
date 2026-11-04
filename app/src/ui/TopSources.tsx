/**
 * 「今日来源 TOP3」—— 嵌在建议卡内（变体 A）。
 *
 * 为什么放在建议卡里而不是另开一张卡：
 * 汇总与解读是同一件事的两半。单独一张卡时，用户看到「米饭 620 kcal」和
 * 「今天纤维差 16 克」会觉得是两件不相干的事；并进同一张卡，
 * 顺序就成了「数据 → 解读」，建议才有依据可循。
 *
 * 它是**只读汇总**：没有编辑入口。改了某一项的克数，TOP3 随记录重算即可。
 *
 * 数字全部来自 core/advice/top.ts（纯函数），这里只负责画。
 */

import type { TopSources as TopData } from '../core/advice/top';

export function TopSources({ top }: { top: TopData }) {
  // 两榜都出不来（没记录 / 来源太少 / 覆盖率不足）就整块不渲染
  if (!top.visible) return null;

  const groups = [top.kcal, top.fat];

  return (
    <div className="topsrc">
      <div className="t3hd">
        <span className="t3t">今日来源 TOP3</span>
        <span className="t3s">按当天全部记录合并计算</span>
      </div>

      {groups.map((g) => (
        <div className="t3g" key={g.key}>
          <div className="t3gl">
            <span className={`t3gt ${g.key}`}>{g.label}</span>
          </div>

          {g.entries ? (
            g.entries.map((e, i) => (
              <div className="t3r" key={`${g.key}-${i}`}>
                <span className="t3rk">{i + 1}</span>
                <span className="t3nm" title={e.name}>{e.name}</span>
                <span className="t3bar">
                  <i className={g.key} style={{ width: `${e.pct}%` }} />
                </span>
                <span className="t3vl">
                  <b>{e.value}</b> {g.unit}
                  <span className="t3pc">{e.pct}%</span>
                </span>
              </div>
            ))
          ) : (
            // 「—」而不是 0：这个榜出不来是数据不足，不是「今天没热量」
            <div className="t3none">— 数据不足，暂不排行</div>
          )}
        </div>
      ))}
    </div>
  );
}
