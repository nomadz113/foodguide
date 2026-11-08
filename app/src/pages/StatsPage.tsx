import { useSearchParams } from 'react-router-dom';
import { PeriodSeg, SEG_WIDTH } from '../ui/PeriodSeg';
import { useSwipeTab } from '../ui/swipe';
import { useDietStats } from './stats/useDietStats';
import { useBpStats } from './stats/useBpStats';
import { DietStats } from './stats/DietStats';
import { BpStats } from './stats/BpStats';
import { RegionSkeleton } from '../ui/Loading';

/**
 * 「统计」栏目的外壳。
 *
 * 两块内容共用这个页面但不是一类东西：饮食看的是热量与缺口，血压看的是读数与分级。
 * 混在一条流里滚动，用户会在「这周吃少了」和「这周血压偏高」之间来回跳，
 * 所以用一个分区胶囊隔开 —— **两边各自持有自己的周期选择**（饮食常看季、血压常看月）。
 *
 * 分区状态写在 URL（`?tab=bp`）而不是组件 state，只有一个理由：可深链。
 * 从今日页的血压卡点进来应当直接落在血压分区，返回时也不该把分区丢掉。
 *
 * 两个 hook **都无条件调用**：条件调用 hook 在运行时会直接抛错，而 tsc 看不见
 * （本项目没有 ESLint）。代价是两套查询同时订阅，但都是本地 IndexedDB 区间读，
 * 血压窗口内通常只有个位数记录，成本可以忽略。
 */
type Tab = 'diet' | 'bp';

export function StatsPage() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get('tab') === 'bp' ? 'bp' : 'diet';

  const diet = useDietStats();
  const bp = useBpStats();

  const active = tab === 'diet' ? diet : bp;
  const sub = (tab === 'diet' ? diet.view : bp.view)?.sub;

  /**
   * 必须 replace。
   *
   * 安卓返回键只看 `history.state.idx > 0`，push 意味着「每点一次分区就多一条历史」，
   * 返回键会变成在饮食/血压之间来回跳，而不是离开统计页。
   * 切回饮食时写空对象，URL 回到干净的 `/stats`（没有 `?`），旧行为一字不变。
   */
  const pick = (t: Tab) =>
    setSp(t === 'diet' ? {} : { tab: t }, { replace: true });

  /**
   * 左右滑动切分区。顺序与 Tab 一致：饮食在左、血压在右，
   * 所以右滑回饮食、左滑去血压 —— 和系统里「左滑翻到下一页」同向。
   *
   * 已经在边界上就什么都不做：从血压继续左滑不该跳到别处（本页只有两个分区）。
   * 判定逻辑（主轴、位移、时长）全在 ui/swipe.ts，这里只负责「往哪走」。
   */
  const swipe = useSwipeTab(
    () => { if (tab === 'bp') pick('diet'); },
    () => { if (tab === 'diet') pick('bp'); },
  );

  return (
    <>
      {/* 头部：分区（下划线 Tab）+ 周期（胶囊）。
          原来这里是两层胶囊 —— 上面「周/月/季」、下面「饮食/血压」，形态一模一样，
          层级只靠「全宽 vs 132 宽」撑着，同屏叠在最上方，读起来像两个并列的按钮组。
          现在两种形态分开：Tab 切「看哪一类」，胶囊切「看哪一段」。
          同时去掉 h1 —— 原来 h1 写「进度」而 Tab 写「饮食」，同一个分区两个名字，
          用户得先猜「进度」和「饮食」是不是同一件事。Tab 本身就是标题。 */}
      <div className="stathd">
        <div className="stathd-row">
          {/* 语义给 group 而不是 tablist：ARIA 的 tablist 要求 roving tabindex 与方向键，
              只挂 role="tab" 不实现键盘交互，比不写更糟。 */}
          <div className="ptabs" role="group" aria-label="统计分区">
            <button
              className={tab === 'diet' ? 'on' : ''}
              aria-pressed={tab === 'diet'}
              onClick={() => pick('diet')}
            >
              饮食
            </button>
            <button
              className={tab === 'bp' ? 'on' : ''}
              aria-pressed={tab === 'bp'}
              onClick={() => pick('bp')}
            >
              血压
            </button>
          </div>
          <PeriodSeg
            kind={active.kind}
            onChange={active.changeKind}
            style={{ width: SEG_WIDTH }}
            label="统计窗口"
          />
        </div>
        {/* sub 为空时**留空**而不是写「读取中…」：有文案和没文案会把这一行的高度
            从 17 变到 0，切分区时页面上下抖一下。.stathd-sub 现在固定 min-height:17px，
            所以这里只要不写字就行。等待语言统一交给 .main 里的骨架。 */}
        <div className="stathd-sub">{sub ?? ''}</div>
      </div>

      {/* key={tab}：切分区时重建滚动容器，把上一次的滚动位置归零。
          没有它，从血压分区底部切到饮食分区会落在中段的某张卡片上。

          滑动手势挂在滚动容器上而不是整页：手指落在这里才算「在内容上滑」，
          页头的 Tab 与周期胶囊保持纯点击（`.main.swipe` 里 touch-action 放行纵向滚动）。 */}
      <div className="main swipe" key={tab} {...swipe}>
        {tab === 'diet'
          ? (diet.view ? <DietStats st={diet} /> : <RegionSkeleton />)
          : (bp.view ? <BpStats st={bp} /> : <RegionSkeleton />)}
      </div>
    </>
  );
}
