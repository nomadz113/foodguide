/**
 * `.cval` 撞切缝门禁 —— 验三件事：撞的要让路、没撞的不许动、**让路之后仍然撞的要退到隐藏**。
 *
 * 背景：目标虚线的 1px 卡片色切缝在数字下方垫一条 `--card` 色的带（半高 1.75px）。
 * 数字底色一被换掉，`--bar-fg` 对 `--card` 只有 1.09（深）/ 1.01（浅）→ 数字被横向抹断。
 *
 * 判据共三段（不是两段）：
 *   1. 柱顶带 [barTop+4, barTop+16] 不撞 → 正常放柱顶；
 *   2. 柱底带 [H−16, H−4] = [80, 92] 不撞 → 翻到柱底（`.cval.low`）；
 *   3. 两段都撞 → 不画（`.cval.hide`）。**这一段是我第一版漏掉的**：
 *      短柱 + 虚线偏低（`maxDay > 5.4 × 目标`）时，柱底带正好被虚线穿过，翻下去照样被抹断。
 *
 * 虚线位置由数据决定：`lineY = H(1 − 目标/maxBar)`，`maxBar = max(目标×1.15, 最高那天)`。
 * 所以按「最高那天 ÷ 目标」= m 扫：m ≥ 15.36 时线已低到柱底带之外，m ∈ (5.38, 15.36) 是危险区。
 *
 * 断言：
 *   A1 任何数字（正常 / `.low` / 隐藏）都不得与切缝带相交；
 *   A2 `.low` 的数字底边 = 柱底 − 4；
 *   A3 正常的数字顶边 = 柱顶 + 4；
 *   A4 该让路却没让路（漏判）为 0；
 *   A5 建议的封顶 m ≤ 2.5 下，`.hide` 一次都不触发（三段判据里第三段永远走不到）。
 *
 * 用法：node tools/ux-probe11.mjs [--verbose]
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');
const VERBOSE = process.argv.includes('--verbose');

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => { try { readFileSync(p, { flag: 'r' }); return true; } catch { return false; } });

const H = 96;
/**
 * 切缝不是以虚线为中心对称的：`.ctarget` 是 height:0 + `border-top:1.5px`，
 * 边框盒 = [lineY, lineY+1.5]；`box-shadow: 0 0 0 1px` 从**边框盒**向外扩 1px
 * → 整条卡片色带 = [lineY − 1, lineY + 2.5]，共 3.5px，**向上 1px、向下 2.5px**。
 * 用 ±1.75 去判会在"线刚好在数字下方"的那一侧漏 0.75px —— 这正是门禁抓到的边界失败。
 */
const SEAM_UP = 2;       // 相对**标称** lineY 向上 2px
const SEAM_DOWN = 1;     // 相对**标称** lineY 向下 1px
/* 为什么是 2 / 1 而不是对称的：实测（dsf 3）
   · `.ctarget` 的 `border-top: 1.5px` 被 Chromium 取整成 **1px**；
   · border 画在内容盒**之上**，所以虚线实际比 `bottom:` 标称位置高 **1px**；
   · `box-shadow: 0 0 0 1px` 再从边框盒向外扩 1px。
   → 以标称 lineY 为原点，卡片色带 = [lineY − 2, lineY + 1]，共 3px 上下不对称。
   实测某例：标称 48 → 实际 [47.16, 48.16]，再各加 1px shadow = [46.16, 49.16]。
   用对称 ±1.75 去判，在「线刚好在数字下方」那一侧会漏 0.5~0.8px。 */
const NUM_TOP = 4;
const NUM_BOT = 16;
/* 判据要留余量：`height:%;` 的柱高和 border 取整都带 0~1px 误差，
   按「刚好不撞」判，实测仍会在边界处咬进 0.2~0.8px。留 1.5px 之后实测零相交。 */
const MARGIN = 1.5;
const BOT_BAND = [H - 16, H - 4];   // [80, 92]

/** 三段判据 —— 与 DietStats.tsx 应逐字一致 */
function place(lineY, barTop) {
  const hit = (top, bot) => lineY + SEAM_DOWN + MARGIN > top && lineY - SEAM_UP - MARGIN < bot;
  if (!hit(barTop + NUM_TOP, barTop + NUM_BOT)) return 'top';
  if (!hit(BOT_BAND[0], BOT_BAND[1])) return 'low';
  return 'hide';
}

const MULTS = [1.15, 1.3, 1.6, 2, 2.5, 3, 4, 5, 5.4, 6, 8, 12, 16];
const PCTS = [22, 24, 26, 28, 30, 33, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100];

const FIX_CSS = `.cval.low { top: auto; bottom: 4px; } .cval.hide { display: none; }`;

const body = (m) => {
  const lineY = H * (1 - 1 / m);
  return `<div class="app" style="width:100%"><div class="main"><div class="card">
  <div class="title row"><span>每日热量</span><span>虚线为目标</span></div>
  <div class="chart-bars">
    ${PCTS.map((pct) => {
      const barTop = H * (1 - pct / 100);
      const cls = place(lineY, barTop);
      return `<div class="ccol"><div class="cbar-slot">
        <div class="cbar" data-pct="${pct}" style="height:${pct}%">
          <span class="cval${cls === 'low' ? ' low' : cls === 'hide' ? ' hide' : ''}" data-cls="${cls}">1,902</span>
        </div></div></div>`;
    }).join('')}
    <div class="ctarget" id="ct" style="bottom:${(1 / m) * 100}%;"></div>
  </div>
</div></div></div>`;
};

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 1000, deviceScaleFactor: 3 });

const results = [];
for (const theme of ['dark', 'light']) {
  for (const m of MULTS) {
    await page.setContent(
      `<!doctype html><meta charset=utf-8><html data-theme="${theme}"><body style="margin:0;background:var(--bg)">
       <style>${css}</style><style>${FIX_CSS}</style>${body(m)}</body></html>`,
      { waitUntil: 'load' },
    );
    const items = await page.evaluate(({ seamUp, seamDown }) => {
      const cb = document.querySelector('.chart-bars').getBoundingClientRect();
      const line = document.getElementById('ct').getBoundingClientRect();
      // 全部换算成「图表容器内坐标」：否则 rect 是视口坐标、判据是容器坐标，两者比不了
      return [...document.querySelectorAll('.cbar')].map((bar) => {
        const r = bar.getBoundingClientRect();
        const num = bar.querySelector('.cval');
        const n = num.getBoundingClientRect();
        const hidden = getComputedStyle(num).display === 'none';
        const top = (v) => +(v - cb.top).toFixed(2);
        return {
          pct: +bar.dataset.pct, cls: num.dataset.cls, hidden,
          barTop: top(r.top), barBot: top(r.bottom),
          numTop: hidden ? null : top(n.top), numBot: hidden ? null : top(n.bottom),
          lineY: +(line.top - cb.top).toFixed(2),
          hits: hidden ? false : (n.top < line.top + seamDown && n.bottom > line.top - seamUp),
        };
      });
    }, { seamUp: SEAM_UP, seamDown: SEAM_DOWN });
    results.push({ theme, m, lineY: +(H * (1 - 1 / m)).toFixed(2), items });
  }
}
await browser.close();

let failed = 0;
const assert = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };

for (const { theme, m, lineY, items } of results) {
  const cnt = (c) => items.filter((i) => i.cls === c).length;
  const hits = items.filter((i) => i.hits);
  const missed = items.filter((i) => i.cls === 'top' && (i.lineY + SEAM_DOWN > i.barTop + NUM_TOP && i.lineY - SEAM_UP < i.barTop + NUM_BOT));
  const tag = `${theme === 'dark' ? '深' : '浅'} 最高那天=${m}× 目标 → 虚线距顶 ${lineY}px`;
  if (!VERBOSE && !hits.length && !missed.length) {
    console.log(`  ✓ ${tag}｜顶 ${cnt('top')} / 底 ${cnt('low')} / 隐 ${cnt('hide')}`);
    continue;
  }
  console.log(`\n${tag}：顶 ${cnt('top')} / 底 ${cnt('low')} / 隐 ${cnt('hide')}`);
  if (hits.length) console.log(`  相交：${hits.map((h) => `${h.pct}%(${h.cls})`).join(' ')}`);
  assert(hits.length === 0, 'A1 没有数字与切缝带相交');
  assert(missed.length === 0, `A4 没有漏判${missed.length ? '：' + missed.map((x) => x.pct + '%').join(' ') : ''}`);
  const low = items.filter((i) => i.cls === 'low');
  if (low.length) assert(low.every((f) => Math.abs(f.numBot - (f.barBot - 4)) < 0.6), `A2 翻柱底的 ${low.length} 根底边 = 柱底−4`);
  const top = items.filter((i) => i.cls === 'top');
  if (top.length) assert(top.every((n) => Math.abs(n.numTop - (n.barTop + 4)) < 0.6), `A3 柱顶的 ${top.length} 根顶边 = 柱顶+4`);
}

console.log('\n分界（按 maxDay ÷ 目标 = m）：');
const dangerFrom = +(1 / (1 - (BOT_BAND[0] - SEAM_DOWN - MARGIN) / H)).toFixed(2);
const dangerTo = +(1 / (1 - (BOT_BAND[1] + SEAM_UP + MARGIN) / H)).toFixed(2);
console.log(`  柱底带 [${BOT_BAND[0]}, ${BOT_BAND[1]}] 被虚线穿过：m ∈ (${dangerFrom}, ${dangerTo})`);
console.log(`  → 这段区间里第三段判据（隐藏）才被用到；m ≤ ${dangerFrom} 时永远走不到`);

const safeZone = results.filter((r) => r.m <= 2.5);
assert(safeZone.every((r) => r.items.every((i) => i.cls !== 'hide')),
  `A5 封顶 m ≤ 2.5 时一次都不触发 .hide（${safeZone.length} 个 m 值 × ${safeZone[0].items.length} 根柱）`);
const outlier = results.filter((r) => r.m > dangerFrom && r.m < dangerTo);
assert(outlier.every((r) => r.items.every((i) => !i.hits)), '危险区里靠第三段判据兜住了（无相交）');

console.log(failed ? `\n${failed} 条断言失败\n` : '\n全部断言通过\n');
process.exit(failed ? 1 : 0);
