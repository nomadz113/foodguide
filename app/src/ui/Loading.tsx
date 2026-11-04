/**
 * 加载态：全项目只有两种等待语言。
 *
 * 之前的四段视觉语言（纯背景 → 「正在准备本地数据…」→「读取中…」→ 真实页面），
 * 其中两处「读取中…」还会同屏出现，字号分别是 10.5/12/12.5。用户读到的是
 * 「这个 App 好像一直在准备什么」，而不是「我的数据马上就来」。
 *
 * 现在统一成：
 *   · PageSkeleton   —— 全屏（替换 bootstrap 阶段与整页分包加载）
 *   · RegionSkeleton —— 区块（替换统计页图表区）
 *
 * 两条纪律：
 * 1. **只画纸和位置，不画数字、进度弧、绿点、文字标签。** 那时还没读到数据，
 *    写「0 kcal」就是撒谎；画一个「已达标」的绿点更是。
 * 2. **块高按真实 CSS 算好（±2px）。** 换真内容时上下不跳 —— 跳一下比多等 200ms
 *    更让人不安，因为它看起来像「刚才那一屏是错的」。
 *
 * 骨架类名一律 sk- 前缀，**绝不复用 .hdr / .card / .main 这些真类名**：
 * tools/check-*.mjs 里有十几处 waitForSelector('.hdr') / ('.card')，
 * 骨架一旦命中真类名，「等真页面出来」的断言会在骨架阶段就通过 —— 验收工具静默失灵。
 */
export function PageSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <div className="sk-page">
      {/* 形状层对读屏完全隐藏：它没有语义，念出来只是噪音 */}
      <div className="sk-shapes" aria-hidden="true">
        {/* 页头：与 .hdr 同一套 padding（14/16/10），h1 行盒 28、sub 行盒 17，合计 72px。
            真实 .hdr 是 71.98px（h1/sub 的行盒带小数），骨架取整到 72 → 差 +0.02px，
            在 ±2px 容差内（ux-probe10 实测三个场景均 ≤+0.02px）。刻意不用 27.6/17.4
            这类小数高度去凑 0px —— 0.02px 不可感知，不值得为此引入非整数的骨架尺寸。 */}
        <div className="sk-hdr">
          <div className="sk-hdcol">
            <span className="sk sk-h1" />
            <span className="sk sk-sub" />
          </div>
          <span className="sk sk-pill" />
        </div>

        {/* 中性主体：**不指向任何具体页**。Today 是唯一非懒加载页，所以这个骨架
            实际上只在另外 10 个页面上出现 —— 画成今日页会先承诺一个错误版式，
            用户点进统计页时再看着它整体位移半屏。中性块只承诺「有内容正在来」。 */}
        <div className="sk-body">
          <span className="sk sk-bar" style={{ width: '62%' }} />
          <span className="sk sk-bar" style={{ width: '84%' }} />
          <div className="sk sk-block" />
        </div>
      </div>

      {slow && (
        /* 4s 兜底。卓易通容器里的 WebView 版本未知，IndexedDB 被系统策略卡住时
           **不会 reject、只会永挂** —— 那时的界面如果只是一句永远不变的文案，
           用户唯一的出路是杀进程。必须有「重试」。 */
        <div className="sk-timeout" role="status">
          还在读本地数据…
          <button className="sk-retry" onClick={() => window.location.reload()}>重试</button>
        </div>
      )}
    </div>
  );
}

/**
 * 区块骨架：只用在统计页的图表区。
 *
 * 复用「这天没记录」那根 2px 空柱的语义（.cbar.none 也是 --track 色的细柱），
 * 所以「正在读」和「这天没记」在视觉上是同一件事，不需要新语言，也不撒谎。
 */
export function RegionSkeleton() {
  const heights = [42, 66, 84, 58, 74, 92, 48];
  return (
    <div className="sk-region" aria-hidden="true">
      <span className="sk sk-ln w40" />
      <div className="sk-bars">
        {heights.map((h, i) => (
          <span key={i} className="sk" style={{ height: `${h}%` }} />
        ))}
      </div>
      <span className="sk sk-ln" style={{ marginTop: 12 }} />
      <span className="sk sk-ln w60" />
      <span className="sk sk-ln" />
    </div>
  );
}
