/**
 * 「今日来源 TOP3」设计稿渲染器。
 *
 *   node tools/make-topsrc-mock.mjs
 *
 * 产出 design/top-sources-mock.png —— 两个变体并排，供拍板选型。
 *
 * 为什么单独渲染而不是改真代码：
 * 这个模块还没定版（放建议卡内 vs 独立卡片），定版前先把两种形态画出来，
 * 免得为了看一眼效果就往 index.css 里塞半套样式。
 *
 * 视觉一律复用 index.css 的真实变量与类名，不另造一套 —— 否则稿子和真机必然分叉。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '..');
const OUT = resolve(ROOT, 'design/top-sources-mock.png');

/** 示例数据 —— 总量与截图对齐：1940 kcal / 钠 608mg / 纤维 14g */
const DATA = {
  kcalTotal: 1940,
  fatTotal: 65,
  topKcal: [
    { name: '米饭', v: 620, pct: 32 },
    { name: '红烧肉', v: 320, pct: 16 },
    { name: '牛肉', v: 190, pct: 10 },
  ],
  topFat: [
    { name: '红烧肉', v: 28, pct: 43 },
    { name: '大豆油', v: 14, pct: 22 },
    { name: '鸡蛋', v: 9, pct: 14 },
  ],
};

const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');

/** 建议卡（改造前后共用） */
function adviceCard({ withTop } = {}) {
  return `
  <div class="advice">
    <div class="h"><span>✦</span><span>今天纤维差16克</span><em class="adv-src">AI</em></div>
    ${withTop ? topBlock() : ''}
    <p>只吃了14g纤维，离30g目标差得远。早餐没蔬菜，午餐晚餐里有胡萝卜、白萝卜但量少，绿叶菜完全缺失。</p>
    <ul class="adv-acts">
      <li>加 500g 绿叶菜（约 11g 纤维），剩 5g 分几次用水果和杂豆补，一顿吃不完</li>
    </ul>
    <div class="adv-foot">
      <span class="planline">早餐 444 · 午餐 559 · 晚餐 937</span>
      <button class="adv-btn">换一种说法</button>
    </div>
  </div>`;
}

/**
 * 汇总区块 —— 两种变体共用同一段 HTML，只是外层包裹不同。
 *
 * 条长 = 这一项占当日总量的真实百分比，与右侧标签同一个数。
 * 不按「第一名满格」归一化 —— 那会让 32% 画成满条，数字和图形说两套话。
 * 这也和首页宏量条（fill 宽 = 值/目标）保持同一个约定。
 */
function topBlock() {
  const row = (i, name, v, unit, pct, tone) => `
    <div class="t3r">
      <span class="t3rk">${i}</span>
      <span class="t3nm">${name}</span>
      <span class="t3bar"><i class="${tone}" style="width:${pct}%"></i></span>
      <span class="t3vl"><b>${v}</b> ${unit}<span class="t3pc">${pct}%</span></span>
    </div>`;
  const kcalRows = DATA.topKcal.map((x, i) => row(i + 1, x.name, x.v, 'kcal', x.pct, 'kcal')).join('');
  const fatRows = DATA.topFat.map((x, i) => row(i + 1, x.name, x.v, 'g', x.pct, 'fat')).join('');
  return `
  <div class="topsrc">
    <div class="t3hd">
      <span class="t3t">今日来源 TOP3</span>
      <span class="t3s">按当天全部记录合并计算</span>
    </div>
    <div class="t3g">
      <div class="t3gl"><span class="t3gt k">热量</span></div>
      ${kcalRows}
    </div>
    <div class="t3g">
      <div class="t3gl"><span class="t3gt f">脂肪</span></div>
      ${fatRows}
    </div>
  </div>`;
}

/** 变体 B：独立卡片 */
function topCard() {
  return `
  <div class="card topcard">
    <div class="title row"><span>今日来源 TOP3</span><span class="t3s">按当天全部记录合并计算</span></div>
    <div class="t3g">
      <div class="t3gl"><span class="t3gt k">热量</span></div>
      ${DATA.topKcal.map((x, i) => `
        <div class="t3r">
          <span class="t3rk">${i + 1}</span>
          <span class="t3nm">${x.name}</span>
          <span class="t3bar"><i class="kcal" style="width:${x.pct}%"></i></span>
          <span class="t3vl"><b>${x.v}</b> kcal<span class="t3pc">${x.pct}%</span></span>
        </div>`).join('')}
    </div>
    <div class="t3g">
      <div class="t3gl"><span class="t3gt f">脂肪</span></div>
      ${DATA.topFat.map((x, i) => `
        <div class="t3r">
          <span class="t3rk">${i + 1}</span>
          <span class="t3nm">${x.name}</span>
          <span class="t3bar"><i class="fat" style="width:${x.pct}%"></i></span>
          <span class="t3vl"><b>${x.v}</b> g<span class="t3pc">${x.pct}%</span></span>
        </div>`).join('')}
    </div>
  </div>`;
}

/** 手机屏内的一段内容（上方留「今日」标题与顶部信息，模拟真实滚动位置） */
function phoneInner(variant) {
  const top = variant === 'B'
    ? `${topCard()}${adviceCard()}`
    : `${adviceCard({ withTop: true })}`;
  return `
  <div class="hdr">
    <div><h1>今天</h1><div class="sub">减脂 · 11 餐 · 23 项</div></div>
    <span class="pill">剩 68 kcal</span>
  </div>
  <div class="main">
    <div class="card">
      <div class="title row"><span>微量营养素</span><span class="t3s">— 表示数据不足</span></div>
      <div class="mgrid">
        <div class="mcell hit"><span class="dot"></span><span class="lb">钙</span><span class="vv">707</span></div>
        <div class="mcell hit"><span class="dot"></span><span class="lb">铁</span><span class="vv">18</span></div>
        <div class="mcell hit"><span class="dot"></span><span class="lb">锌</span><span class="vv">13</span></div>
        <div class="mcell hit"><span class="dot"></span><span class="lb">硒</span><span class="vv">78</span></div>
        <div class="mcell hit"><span class="dot"></span><span class="lb">钾</span><span class="vv">3399</span></div>
        <div class="mcell hit"><span class="dot"></span><span class="lb">镁</span><span class="vv">404</span></div>
        <div class="mcell"><span class="dot"></span><span class="lb">纤维</span><span class="vv">14</span></div>
      </div>
    </div>
    ${top}
  </div>`;
}

/** 示例图专用样式（只在这里加，不进 index.css —— 定版前不进真代码） */
const mockCss = `
.topsrc {
  margin-top: 9px; padding: 9px 10px 10px;
  background: var(--info-inset); border-radius: 10px;
}
.t3hd { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 7px; }
.t3t { font-size: 11px; font-weight: 650; color: var(--info-fg); }
.t3s { font-size: 9.5px; color: var(--info-fg2); }
.t3g { padding: 5px 0; }
.t3g + .t3g { border-top: 1px dashed var(--info-line); }
.t3gl { margin-bottom: 5px; }
.t3gt { font-size: 9.5px; font-weight: 650; padding: 1px 7px; border-radius: 20px; }
.t3gt.k { color: #1d4ed8; background: rgba(37,99,235,0.12); }
.t3gt.f { color: #b45309; background: rgba(180,83,9,0.12); }
.t3r { display: flex; align-items: center; gap: 7px; height: 22px; }
.t3rk {
  width: 14px; height: 14px; flex: 0 0 auto; border-radius: 4px;
  font-size: 9px; font-weight: 650; color: var(--info-fg2);
  background: var(--card); display: flex; align-items: center; justify-content: center;
}
.t3nm { flex: 0 0 auto; font-size: 11px; color: var(--body-fg); min-width: 52px; }
.t3bar { flex: 1 1 auto; height: 5px; border-radius: 3px; background: var(--track); overflow: hidden; }
.t3bar i { display: block; height: 100%; border-radius: 3px; }
.t3bar i.kcal { background: linear-gradient(90deg, #60a5fa, #3b82f6); }
.t3bar i.fat { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
.t3vl { flex: 0 0 auto; font-size: 10px; color: var(--info-fg2); font-variant-numeric: tabular-nums; }
.t3vl b { color: var(--fg); font-weight: 650; }
.t3pc { margin-left: 4px; opacity: 0.8; }

.topcard .t3g + .t3g { border-top: 1px solid var(--line-soft); margin-top: 6px; padding-top: 7px; }
.topcard .t3g:first-of-type { padding-top: 2px; }
`;

const page = `
<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8">
<style>
${css}
${mockCss}
/* ── 画布 ── */
body { margin: 0; background: #e9edf4; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.canvas { width: 1080px; padding: 30px 30px 26px; }
.chead { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 20px; }
.chead h1 { font-size: 20px; font-weight: 700; margin: 0 0 5px; color: #0f172a; }
.chead p { margin: 0; font-size: 12px; color: #5b6b80; }
.cbadges { display: flex; gap: 6px; }
.cbadge { font-size: 10.5px; padding: 3px 9px; border-radius: 20px; background: #fff; border: 1px solid #dde3ec; color: #475569; }
.variants { display: flex; gap: 22px; }
.vcol { flex: 1; }
.vlabel { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.vtag { font-size: 11px; font-weight: 700; color: #fff; background: #1d4ed8; border-radius: 6px; padding: 2px 8px; }
.vtag.alt { background: #6d28d9; }
.vname { font-size: 13px; font-weight: 650; color: #0f172a; }
.vdesc { font-size: 10.5px; color: #64748b; }
.phone {
  background: #fff; border: 1px solid #dde3ec; border-radius: 18px; overflow: hidden;
  box-shadow: 0 2px 10px rgba(15,23,42,.07);
}
.phone .app { height: auto; }
.phone .main { padding: 0 12px 14px; }
.phone .hdr { padding: 12px 12px 8px; }
.phone .hdr h1 { font-size: 19px; }
.phone .pill { font-size: 10.5px; padding: 3px 9px; border-radius: 20px; background: #dcfce7; color: #15803d; font-weight: 650; }
.phone .card { padding: 11px; border-radius: 13px; margin-top: 8px; }
.phone .mcell .lb { font-size: 8.5px; }
.phone .mcell .vv { font-size: 9.5px; }
.legend { margin-top: 22px; background: #fff; border: 1px solid #dde3ec; border-radius: 14px; padding: 16px 18px; }
.legend h2 { font-size: 13px; font-weight: 700; color: #0f172a; margin: 0 0 12px; }
.lgrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 26px; }
.lrow { display: flex; gap: 9px; align-items: flex-start; }
.lrow i { width: 3px; align-self: stretch; border-radius: 2px; background: #1d4ed8; flex: 0 0 auto; }
.lrow.f i { background: #b45309; }
.lrow.g i { background: #15803d; }
.lrow.p i { background: #6d28d9; }
.lrow b { font-size: 11.5px; color: #0f172a; font-weight: 650; display: block; margin-bottom: 2px; }
.lrow span { font-size: 10.5px; color: #475569; line-height: 1.55; }
</style></head><body>
<div class="canvas">
  <div class="chead">
    <div>
      <h1>今日来源 TOP3 —— 热量 / 脂肪</h1>
      <p>示例数据取自今日实际记录口径（总热量 1,940 kcal）· 两个变体供选型</p>
    </div>
    <div class="cbadges"><span class="cbadge">今日页</span><span class="cbadge">浅色主题</span><span class="cbadge">390px</span></div>
  </div>

  <div class="variants">
    <div class="vcol">
      <div class="vlabel"><span class="vtag">变体 A</span><span class="vname">并入 AI 建议卡</span></div>
      <div class="vdesc">汇总与 AI 叙述同卡，形成「数据 → 解读」的完整诊断</div>
      <div class="phone"><div class="app">${phoneInner('A')}</div></div>
    </div>
    <div class="vcol">
      <div class="vlabel"><span class="vtag alt">变体 B</span><span class="vname">独立卡片</span></div>
      <div class="vdesc">汇总独立于 AI，未点「让 AI 细说」时也在</div>
      <div class="phone"><div class="app">${phoneInner('B')}</div></div>
    </div>
  </div>

  <div class="legend">
    <h2>图例与计算口径</h2>
    <div class="lgrid">
      <div class="lrow i"><div><b>归组：同名合并，拆解按食材</b><span>早中晚三碗米饭合并成一项（620 kcal）；「番茄炒蛋」的番茄/鸡蛋/油各算一项 —— 所以「油」能上脂肪榜，正是「拍照必须拆油」要的引导力</span></div></div>
      <div class="lrow f i"><div><b>分母：当日该项总量</b><span>热量 1,940 kcal、脂肪 65 g。百分比是「这一项占全天多少」，不是「在榜单内部占多少」</span></div></div>
      <div class="lrow g i"><div><b>轨道＝全天 100%，填充＝这一项占多少</b><span>条长与右侧数字永远一致（620 kcal 就是 32%），不按「第一名满格」归一化 —— 那样 32% 会画成满条，数字和图形说两套话</span></div></div>
      <div class="lrow p i"><div><b>数字由代码算，AI 只能引用</b><span>TOP3 走纯函数；数字随 payload 喂给模型并登记进 allowedNumbers，模型照抄可以、自己编的数字会被整条丢弃</span></div></div>
      <div class="lrow i"><div><b>数据不足就不显示</b><span>脂肪覆盖率 &lt; 50%（COVERAGE_MIN）时该榜显示「—」，不拿半份数据当全天说</span></div></div>
      <div class="lrow f i"><div><b>少于 3 项不出榜</b><span>只吃了两样东西时「TOP3」是伪信息，整块隐藏</span></div></div>
      <div class="lrow g i"><div><b>颜色：蓝＝热量，琥珀＝脂肪</b><span>直接复用首页宏量条配色（--macro-fat 琥珀），不引入第三种色；深色主题同色系自动跟随</span></div></div>
      <div class="lrow p i"><div><b>不做「换一种说法」以外的交互</b><span>这是只读汇总，没有编辑入口 —— 改了某一项的克数，TOP3 随记录重算即可</span></div></div>
    </div>
  </div>
</div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 1080, height: 1200, deviceScaleFactor: 2 },
});
const p = await browser.newPage();
await p.setContent(page, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));
const el = await p.$('.canvas');
mkdirSync(dirname(OUT), { recursive: true });
await el.screenshot({ path: OUT });
await browser.close();
console.log('已生成', OUT);
