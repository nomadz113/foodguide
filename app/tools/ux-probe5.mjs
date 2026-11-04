/**
 * 第五轮：目标虚线穿过柱子时"到底看不看得见"。
 *
 * 用规范里现成的两套色板（从 设计规范-好好吃饭-V2.md 里抓 ```css 块）叠加在
 * 真实 index.css 上，画 7 根柱（最高那根越线），导出三种变体的卡片截图：
 *   A 只画柱（基准）  B 加虚线  C 虚线 + 1px 卡片色描边（"切缝"）
 * 截图在 app/shots/ux-target-*.png，人工判读用；对比度数值另算。
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');
const spec = readFileSync(resolve(APP, '../设计规范-好好吃饭-V2.md'), 'utf8');
const palette = [...spec.matchAll(/```css\r?\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
if (!palette.includes('#5E7A2A')) throw new Error('V2 色板没抽出来（检查 ```css 代码围栏与 CRLF）');
const OUT = resolve(APP, '../shots');
mkdirSync(OUT, { recursive: true });

const GEOM = `
.cbar{border-radius:6px 6px 2px 2px}
.cval{font-size:12px;font-weight:500;letter-spacing:-0.01em;line-height:1;top:4px}
.chart-lbs span{font-size:12px}
.ctarget{border-top:1.5px dashed var(--target-line);z-index:2}
.cut .ctarget{box-shadow:0 0 0 1px var(--card)}
`;

// 7 天，最高那天 = 目标 1.152 倍 → targetPct 86.8%（虚线距顶 12.7px），
// 正好落在 `.cval` 修正后的数字带 [4,16] 里 —— 最坏的相遇位置
const vals = [0.62, 0.78, 0.9, 0.71, 1.152, 0.83, 0.68];
const goal = 1902;
const maxBar = goal * 1.15;
const cvalGate = vals.map((v) => (v * goal) / maxBar);

const body = (mode) => `
<div class="app"><div class="main">
  <div class="card">
    <div class="title row"><span>每日热量</span><span style="font-size:12px;color:var(--mute)">虚线为目标 1,902</span></div>
    <div class="chart-bars ${mode === 'C' ? 'cut' : ''}">
      ${vals.map((v, i) => `<div class="ccol"><div class="cbar-slot"><div class="cbar${v > 1.1 ? ' over' : ''}" style="height:${(v * goal / maxBar * 100).toFixed(1)}%">
        ${cvalGate[i] >= 0.26 ? `<span class="cval">${Math.round(v * goal).toLocaleString()}</span>` : ''}
      </div></div></div>`).join('')}
      ${mode === 'A' ? '' : `<div class="ctarget" style="bottom:${(goal / maxBar * 100).toFixed(2)}%"></div>`}
    </div>
    <div class="chart-lbs">${['一','二','三','四','五','六','日'].map((d) => `<span>${d}</span>`).join('')}</div>
  </div>
</div></div>`;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 360, height: 400, deviceScaleFactor: 3 }); // 3x：1.5px 虚线才看得出形状

const files = [];
for (const theme of ['light', 'dark']) {
  for (const mode of ['A', 'B', 'C']) {
    await page.setContent(
      `<!doctype html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8">
       <style>${css}</style><style>${palette}</style><style>${GEOM}</style></head>
       <body style="margin:0">${body(mode)}</body></html>`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 80));
    const el = await page.$('.card');
    const f = resolve(OUT, `ux-target-${theme}-${mode}.png`);
    await el.screenshot({ path: f });
    files.push(f);
  }
}
await browser.close();
console.log(files.join('\n'));
