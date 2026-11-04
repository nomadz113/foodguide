/**
 * 矿物质「纯文字版」示例图 —— 只出图，不改源码样式。
 *
 * 为什么单独一个脚本：排版方案要来回比，每改一次都跑 build + 插库太重。
 * 这里把真实 index.css 的配色变量抄一份到内联样式里，用 puppeteer 直接渲染，
 * 出来就是 App 的观感，但不动 dist、不动 IndexedDB。
 *
 * 用法：node tools/shoot-mineral-demo.mjs [输出文件名]
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = process.argv[2] ?? resolve(process.cwd(), '../示例-矿物质-纯文字.png');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** 与 示例-矿物质-4加2.png 同一份样例数据，方便直接对照 */
const ITEMS = [
  {
    name: '猪瘦肉丝', kcal: 143, grams: 100, tier: '中份',
    mins: [['钙', '6', 'mg'], ['铁', '1.3', 'mg'], ['锌', '2.9', 'mg'],
      ['硒', '9.5', 'μg'], ['钾', '305', 'mg'], ['镁', '25', 'mg']],
  },
  { name: '孜然粉', kcal: 17, grams: 15, tier: '中份', mins: [] },
  {
    name: '清炒油麦菜', kcal: 75, grams: 150, tier: '中份',
    mins: [['钙', '45', 'mg'], ['铁', '1.2', 'mg'], ['锌', '0.6', 'mg'], ['钾', '210', 'mg']],
    missing: 2,
  },
];

const TOTALS = [
  ['钙', '51', 'mg', '6%'], ['铁', '2.5', 'mg', '21%'], ['锌', '3.5', 'mg', '28%'],
  ['硒', '9.5', 'μg', '16%'], ['钾', '515', 'mg', '26%'], ['镁', '25', 'mg', '8%'],
];

const CSS = `
:root{
  --bg:#f4f6fa; --card:#ffffff; --card2:#eef1f6; --line:#dde3ec; --line-soft:#e6ebf2;
  --fg:#0f172a; --dim:#475569; --mute:#5b6b80; --dim2:#64748b;
  --green:#15803d; --track:#aab6c4; --ok-fg:#15803d; --ok-line:rgba(21,128,61,.28); --ok-bg:rgba(21,128,61,.07);
  --na-off:#94a3b8;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  width:520px;background:var(--bg);color:var(--fg);padding:22px 20px 26px;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
h1{font-size:21px;font-weight:750;letter-spacing:-.01em}
.sub{font-size:11.5px;color:var(--mute);margin-top:5px;line-height:1.6}
.sub b{color:var(--fg);font-weight:650}
.ver{
  display:flex;align-items:baseline;gap:7px;margin:20px 0 7px;
}
.ver .tag{
  font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--green);
  background:var(--ok-bg);border:1px solid var(--ok-line);border-radius:5px;padding:1px 5px;
}
.ver .t{font-size:12.5px;font-weight:650}
.ver .d{font-size:10.5px;color:var(--mute)}

.card{background:var(--card);border:1px solid var(--line-soft);border-radius:14px;padding:11px 12px}
.selitem{background:var(--card);border:1px solid var(--line-soft);border-radius:12px;padding:9px 11px;margin-bottom:7px}
.selitem .top{display:flex;align-items:center;gap:8px}
.selitem .top b{font-size:13px;font-weight:620;flex:1;min-width:0}
.selitem .top .kc{font-size:11px;color:var(--dim)}
.selitem .top .rm{color:var(--mute);font-size:15px;padding-left:4px}
.selitem .ctl{display:flex;align-items:center;gap:8px;margin-top:7px}
.stepper{display:flex;align-items:center;background:var(--card2);border:1px solid var(--line);border-radius:9px;overflow:hidden;flex:0 0 auto}
.stepper span{width:30px;height:29px;color:var(--dim);font-size:15px;display:flex;align-items:center;justify-content:center}
.stepper b{min-width:54px;text-align:center;font-size:12px;font-weight:650}
.tiers3{display:flex;gap:5px;flex:1}
.tiers3 span{
  flex:1;font-size:10.5px;padding:6px 2px;border-radius:8px;text-align:center;
  background:var(--card2);border:1px solid var(--line);color:var(--mute);
}
.tiers3 span.on{border-color:var(--ok-line);background:var(--ok-bg);color:var(--ok-fg);font-weight:650}

/* ── A：一段连续文字 ───────────────────────── */
.mtext{
  margin-top:8px;padding-top:8px;border-top:1px dashed var(--line-soft);
  font-size:11px;line-height:1.8;color:var(--dim);
}
.mtext .n{color:var(--mute)}
.mtext .v{color:var(--fg);font-weight:650;font-variant-numeric:tabular-nums}
.mtext .u{font-size:9px;color:var(--mute);font-weight:400;margin-left:1px}
/* 分隔符不能太淡：淡到看不见时「6mg 铁」会连读成一个词 */
.mtext .dot{color:#94a3b8;margin:0 5px}
.mtext .more{color:var(--mute);margin-left:9px}
.mnone{font-size:10.5px;color:var(--mute);line-height:1.55}

.title{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px}
.title .h{font-size:12.5px;font-weight:650}
.title .c{font-size:10px;color:var(--mute)}

/* ── A：汇总三列纯文字（无底色、无边框、无进度条） ── */
.mgrid-text{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px 10px}
.mgrid-text .c{font-size:11.5px;line-height:1.5;color:var(--dim);white-space:nowrap}
.mgrid-text .c .v{color:var(--fg);font-weight:650;font-variant-numeric:tabular-nums;margin-left:3px}
.mgrid-text .c .u{font-size:9px;color:var(--mute);font-weight:400;margin-left:1px}
.mgrid-text .c .p{color:var(--mute);font-size:10px;margin-left:5px;font-variant-numeric:tabular-nums}

/* ── B：每项一行 ───────────────────────────── */
.mrows{font-size:11.5px}
.mrows .r{display:flex;align-items:baseline;justify-content:space-between;padding:1.5px 0}
.mrows .r .l{color:var(--dim)}
.mrows .r .l b{color:var(--fg);font-weight:650;font-variant-numeric:tabular-nums;margin-left:4px}
.mrows .r .l .u{font-size:9px;color:var(--mute);font-weight:400;margin-left:1px}
.mrows .r .p{color:var(--mute);font-size:10.5px;font-variant-numeric:tabular-nums}

.hint{font-size:10px;line-height:1.6;color:var(--mute);margin-top:10px;text-align:left}
.foot{font-size:10.5px;color:var(--dim2);line-height:1.7;margin-top:18px}
.foot b{color:var(--dim);font-weight:650}
.flabel{font-size:10.5px;color:var(--mute);margin:10px 0 6px}
.searchbox{
  display:flex;align-items:center;gap:8px;background:var(--card);
  border:1px solid var(--line);border-radius:11px;padding:10px 12px;font-size:12px;color:#9aa6b6;
}
`;

/** A 版逐项：一段连续文字 */
function textLine(mins, missing) {
  if (mins.length === 0) return null;
  const parts = mins
    .map(([n, v, u]) => `<span class="n">${n}</span> <span class="v">${v}<span class="u">${u}</span></span>`)
    .join('<span class="dot">·</span>');
  const more = missing ? `<span class="more">另 ${missing} 项库里没有</span>` : '';
  return `${parts}${more}`;
}

function itemCard(it, mode) {
  const body = it.mins.length === 0
    ? '<div class="mtext"><span class="mnone">食物库里没有「孜然粉」，6 项留空；热量和三大宏量不受影响</span></div>'
    : mode === 'A'
      ? `<div class="mtext">${textLine(it.mins, it.missing)}</div>`
      : `<div class="mtext">${textLine(it.mins, it.missing)}</div>`;
  return `
  <div class="selitem">
    <div class="top"><b>${it.name}</b><span class="kc">${it.kcal} kcal</span><span class="rm">×</span></div>
    <div class="ctl">
      <div class="stepper"><span>−</span><b>${it.grams}g</b><span>+</span></div>
      <div class="tiers3"><span>小份</span><span class="on">${it.tier}</span><span>大份</span></div>
    </div>
    ${body}
  </div>`;
}

function summaryA() {
  const cells = TOTALS.map(([n, v, u, p]) =>
    `<div class="c">${n}<span class="v">${v}<span class="u">${u}</span></span><span class="p">${p}</span></div>`,
  ).join('');
  return `
  <div class="card">
    <div class="title"><span class="h">这一餐的矿物质</span><span class="c">2 / 3 项有数据 · 占比为全天目标</span></div>
    <div class="mgrid-text">${cells}</div>
    <div class="hint">微量取自食物库参考值，生熟未折算，还有食材没匹配上库，实际只会更高 —— 这里给的是下限。</div>
  </div>`;
}

function summaryB() {
  const rows = TOTALS.map(([n, v, u, p]) =>
    `<div class="r"><span class="l">${n}<b>${v}<span class="u">${u}</span></b></span><span class="p">占全天 ${p}</span></div>`,
  ).join('');
  return `
  <div class="card">
    <div class="title"><span class="h">这一餐的矿物质</span><span class="c">2 / 3 项有数据</span></div>
    <div class="mrows">${rows}</div>
    <div class="hint">微量取自食物库参考值，生熟未折算，还有食材没匹配上库，实际只会更高 —— 这里给的是下限。</div>
  </div>`;
}

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <h1>编辑这一餐</h1>
  <div class="sub">矿物质<b>不再分成小块</b>：不分格、不描边、不加底色，只留文字。<br>数字仍然加粗对齐，缺项只报数量。</div>

  <div class="ver"><span class="tag">A</span><span class="t">一行文字</span><span class="d">逐项连排、汇总三列素排</span></div>
  ${ITEMS.map((it) => itemCard(it, 'A')).join('')}
  <div class="flabel">再加一项</div>
  <div class="searchbox">⌕&nbsp;&nbsp;搜索食物，如 米饭 / 鸡胸肉</div>
  <div style="height:10px"></div>
  ${summaryA()}

  <div class="ver" style="margin-top:24px"><span class="tag">B</span><span class="t">每项一行</span><span class="d">汇总改成六行列表，占比右对齐</span></div>
  ${summaryB()}

  <div class="foot">
    <b>逐项</b>两版相同（A 版猪瘦肉丝那行）。<b>A</b> 汇总两行读完，和个人档案页的观感一致；<br>
    <b>B</b> 一眼横向扫六项，但多占约 40px。两版都不再有块、进度条和绿条。
  </div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--force-device-scale-factor=2', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 520, height: 1200, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
// fullPage 会把视口剩余高度也截进去 → 底部一片空白。先量内容高度再把视口设成一样高
const h = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
await page.setViewport({ width: 520, height: h, deviceScaleFactor: 2 });
const buf = await page.screenshot({ type: 'png' });
if (process.argv.includes('--debug')) {
  // 汇总三列是不是真的对齐：把每个格子的 x/y 打出来，别靠看缩略图猜
  const box = await page.evaluate(() =>
    [...document.querySelectorAll('.mgrid-text .c')].map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.textContent}  x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)}`;
    }),
  );
  console.log(box.join('\n'));
}
writeFileSync(OUT, buf);
await browser.close();
console.log('saved:', OUT, buf.length, 'bytes');
