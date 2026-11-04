/**
 * B-5 复核：`.spark-lb` 已抬到 12px，SVG 几何有没有跟着让位。
 *
 * 两个口径都测，因为它们的答案不一样：
 *   1. **em 盒**（规范 §5.3.5 用的口径）：字号的 ascent/descent 盒，CJK 的墨迹会顶到接近它的上沿；
 *   2. **墨迹**（像素扫描，ground truth）：把 SVG 画进 canvas 逐行扫第一个非背景像素。
 *
 * 字体栈用产品真实的 `--font-ui`（Windows 上落到 Segoe UI / 微软雅黑，数字 cap 高 ≈0.70em，
 * 安卓 Roboto ≈0.711em —— 差 0.13px，可以互推）。
 *
 * 用法：node tools/ux-probe6.mjs
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

const W = 300;
const PAD_X = 10;
const PAD_T = 14;

const cases = [
  ['现状 Sparkline H=92 / PAD_Y下=10 / y=H-2', 92, 10, 90, '03-01'],
  ['规范 Sparkline H=104 / PAD_Y下=18 / y=H-4', 104, 18, 100, '03-01'],
  ['现状 BpChart H=132 / PAD_B=16 / y=H-4', 132, 16, 128, '03-01'],
  ['规范 BpChart H=132 / PAD_B=18 / y=H-4', 132, 18, 128, '03-01'],
  ['CJK 标签（目标读数）现状 H=92 / y=H-2', 92, 10, 90, '目标 68'],
  ['CJK 标签 规范 H=104 / y=H-4', 104, 18, 100, '目标 68'],
];

const svg_src = (H, padB, labelY, txt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 4}" height="${H * 4}">
<style>
  text{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Roboto","Segoe UI",sans-serif;font-size:12px;fill:#000}
</style>
<rect width="${W}" height="${H}" fill="#fff"/>
<line x1="${PAD_X}" y1="${H - padB}" x2="${W - PAD_X}" y2="${H - padB}" stroke="#ccc" stroke-width="1"/>
<text x="${W / 2}" y="${labelY}" text-anchor="middle" id="ax">${txt}</text>
</svg>`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 500 });
await page.setContent('<body style="margin:0"></body>');

const rows = [];
for (const [name, H, padB, labelY, txt] of cases) {
  const src = svg_src(H, padB, labelY, txt);
  const m = await page.evaluate(async ({ src, H, W, labelY }) => {
    // ---- 1. em 盒与字形盒（用真实 font stack 的 SVG 量）
    const host = document.createElement('div');
    host.innerHTML = src;
    document.body.appendChild(host);
    const svg = host.querySelector('svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const ax = svg.querySelector('#ax');
    const bb = ax.getBBox();                 // em 盒（ascent+descent）
    const ext = ax.getExtentOfChar(0);       // 首字符字形盒
    host.remove();

    // ---- 2. 像素扫描 ink top（4x 超采样后换算回 viewBox 单位）
    const S = 4;
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(src)));
    await new Promise((r, j) => { img.onload = r; img.onerror = j; });
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let inkTopPx = -1;
    for (let y = Math.floor((labelY - 20) * S); y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (data[i] < 96 && data[i + 1] < 96 && data[i + 2] < 96) { inkTopPx = y; break; }
      }
      if (inkTopPx >= 0) break;
    }
    return {
      emTop: bb.y, emH: bb.height,
      glyphTop: ext.y, glyphH: ext.height,
      inkTop: inkTopPx >= 0 ? inkTopPx / S : null,
      family: getComputedStyle(document.body).fontFamily,
    };
  }, { src, H, W, labelY });

  const plotBottom = H - padB;
  rows.push({
    场景: name,
    绘图区底: plotBottom,
    em上沿: +m.emTop.toFixed(2),
    em间隙: +(plotBottom - m.emTop).toFixed(2),
    墨迹上沿: m.inkTop === null ? '-' : +m.inkTop.toFixed(2),
    让出: m.inkTop === null ? '-' : +(m.inkTop - plotBottom).toFixed(2),
    压入: m.inkTop === null ? '-' : +Math.max(0, plotBottom - m.inkTop).toFixed(2),
  });
}
await browser.close();

console.log('\n单位＝viewBox 单位（Sparkline W=300 时 1 单位 ≈ 1 屏幕 px）\n');
const keys = Object.keys(rows[0]);
const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
const pad = (s, n) => String(s) + ' '.repeat(n - String(s).length);
console.log(keys.map((k, i) => pad(k, widths[i])).join('  '));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(keys.map((k, i) => pad(r[k], widths[i])).join('  '));
console.log('\n（ink 是 4x 超采样的像素扫描，比 em 盒更能代表「眼睛看到压没压」）');

// ── 可复跑断言：验的是「设计不变量」，不随现状波动 ──
// 上面表格里的「现状」行是给人看的；下面这几条是给 CI 的。
let failed = 0;
const assert = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };
// 让出 = 墨迹上沿 − 绘图区底（正数=留白，负数=压进去）
const clear = (r) => (typeof r.墨迹上沿 !== 'number' ? NaN : r.墨迹上沿 - r.绘图区底);

const spFixed = rows.find((r) => r.场景.startsWith('规范 Sparkline'));
const bpFixed = rows.find((r) => r.场景 === '规范 BpChart H=132 / PAD_B=18 / y=H-4');
const bp19 = rows.find((r) => r.场景.includes('PAD_B=19'));
console.log('\n断言（设计不变量）');
assert(clear(spFixed) >= 3, `Sparkline 让出 ≥3px（实测 ${clear(spFixed)}）`);
assert(clear(bpFixed) >= 3, `BpChart 让出 ≥3px（实测 ${clear(bpFixed)}）`);
assert(Math.abs(clear(spFixed) - clear(bpFixed)) < 0.01,
  `两张图让出同一个间隙（${clear(spFixed)} vs ${clear(bpFixed)}）—— 这才是「口径一致」的可测定义`);
if (bp19) assert(Math.abs(clear(bp19) - clear(spFixed)) > 0.5, `PAD_B=19 与体重图不同（${clear(bp19)} vs ${clear(spFixed)}）—— 所以 18 而不是 19`);

console.log(failed ? `\n${failed} 条断言失败\n` : '\n全部断言通过\n');
process.exit(failed ? 1 : 0);
