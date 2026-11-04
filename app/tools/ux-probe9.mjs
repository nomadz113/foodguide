/**
 * 「数字压在虚线上」到底还能不能读 —— 用落地的 index.css 实拍，不推演。
 *
 * 实现没有采纳「数字翻到柱底」，而是把 `.cval` 抬到 z-index:3（虚线是 2），
 * 理由是「数字盖在虚线之上，就不需要靠门槛回避」。
 * 但 z-index 只决定**谁在上面**，不决定**数字背后的底色是谁**：
 * 切缝是 1px 卡片色 box-shadow + 1.5px 虚线 = 3.5px 的卡片色带（z-2），
 * 数字（z-3）压上去之后，那 3.5px 里的背景是**卡片色**，而数字颜色是 --bar-fg（奶油/墨）。
 * 奶油字压奶油缝 = 中间一条 3.5px 的字被抹掉。
 *
 * 这个脚本把最坏相遇点（最高柱 = 目标 1.152 倍 → 虚线距图顶 12.7px）按真实标记渲染出来。
 *
 * 用法：node tools/ux-probe9.mjs
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => { try { readFileSync(p, { flag: 'r' }); return true; } catch { return false; } });

const H = 96;                       // .chart-bars height
const GOAL = 1902;
const MAXBAR = GOAL * 1.15;         // useDietStats: max(goal*1.15, maxDay)
const targetPct = (GOAL / MAXBAR) * 100;   // 86.96
// 最坏相遇：最高柱 1.152 × 目标 → 柱高 (1.152/1.15)*100 ≈ 100% → 虚线落在 12.7px 处，正好穿过数字带 [4,16]
const worst = Math.round(GOAL * 1.152);
const bars = [
  { d: '03-04', kcal: 1620 },
  { d: '03-05', kcal: 1755 },
  { d: '03-06', kcal: worst },   // ← 撞线的那根
  { d: '03-07', kcal: 1440 },
  { d: '03-08', kcal: 1902 },
  { d: '03-09', kcal: 1720 },
  { d: '03-10', kcal: 1860 },
];

const BODY = (fix) => `
<div class="app" style="width:100%"><div class="main"><div class="card">
  <div class="title row"><span>每日热量</span><span>虚线为目标 1,902</span></div>
  <div class="chart-bars">
    ${bars.map((b) => {
      const pct = (b.kcal / MAXBAR) * 100;
      const barTop = H * (1 - pct / 100);
      const lineY = H * (1 - targetPct / 100);
      // 和 DietStats.tsx 里那三行判据一致
      const blocked = fix && lineY - 1.75 < barTop + 16 && lineY + 1.75 > barTop + 4;
      return `
      <div class="ccol"><div class="cbar-slot">
        <div class="cbar${b.kcal > GOAL * 1.1 ? ' over' : ''}" style="height:${pct}%">
          ${pct >= 22 ? `<span class="cval${blocked ? ' low' : ''}">${b.kcal.toLocaleString('en-US')}</span>` : ''}
        </div>
      </div></div>`;
    }).join('')}
    <div class="ctarget" style="bottom:${targetPct}%;"></div>
  </div>
  <div class="chart-lbs">${bars.map((b) => `<span>${b.d.slice(4)}</span>`).join('')}</div>
</div></div></div>`;

const FIX_CSS = `.cval.low { top: auto; bottom: 4px; }`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 700, deviceScaleFactor: 4 });

const out = [];
for (const theme of ['dark', 'light']) {
  for (const fix of [false, true]) {
    await page.setContent(
      `<!doctype html><meta charset=utf-8><html data-theme="${theme}"><body style="margin:0;background:var(--bg)">
       <style>${css}</style>${fix ? `<style>${FIX_CSS}</style>` : ''}${BODY(fix)}</body></html>`,
      { waitUntil: 'load' },
    );
    const m = await page.evaluate(() => {
      const t = document.querySelector('.ctarget').getBoundingClientRect();
      const vals = [...document.querySelectorAll('.cval')];
      const hit = vals
        .map((v) => {
          const r = v.getBoundingClientRect();
          return {
            text: v.textContent,
            top: +r.top.toFixed(2),
            bot: +r.bottom.toFixed(2),
            low: v.classList.contains('low'),
            overlapsLine: r.top < t.bottom + 1.75 && r.bottom > t.top - 1.75,
          };
        })
        .filter((v) => v.overlapsLine);
      const cs = getComputedStyle(document.querySelector('.cval'));
      return { lineY: +t.top.toFixed(2), collision: hit, barFg: cs.color, cardBg: getComputedStyle(document.querySelector('.card')).backgroundColor };
    });
    const card = await page.$('.card');
    const p = `shots/ux-cval-${fix ? 'fixed' : 'overlap'}-${theme}.png`;
    await card.screenshot({ path: resolve(APP, p) });
    out.push({ theme, fix, ...m, shot: p });
  }
}
await browser.close();

for (const o of out) {
  console.log(`\n=== ${o.theme} / ${o.fix ? '修好（.cval.low 翻柱底）' : '现状（z-index 3）'} ===`);
  console.log(`虚线 y=${o.lineY}，数字色 ${o.barFg}，卡片底 ${o.cardBg}`);
  console.log(o.collision.length ? `撞线数字：${JSON.stringify(o.collision)}` : '没有数字与虚线带相交 ✅');
  console.log(`截图 ${o.shot}`);
}
