/**
 * 骨架（PageSkeleton）方案 A 的定高实测。
 *
 * 背景：`TodayPage` 是唯一非懒加载页（App.tsx:6），所以 `PageSkeleton` 只会出现在
 * 另外 10 个 lazy 页面上，而它画的是「环 192 + 宏量轨 100 + 便签 137」的今日页形体
 * = 内容到达时整体位移 429px。方案 A 的要求是：**只承诺页头**，其余中性化。
 *
 * 这个脚本只回答两个数：
 *   1. 真实 `.hdr` 与骨架 `.sk-hdr` 的高度差（判据：≤2px）——现在是几？
 *   2. 中性三块（页头 + 2×44 行 + 1×120 区块）在小屏 320×568 上会不会超出一屏
 *      （超了就会出现「加载时没有滚动条、内容到了突然有」的第二种跳动）。
 *
 * 用法：node tools/ux-probe10.mjs
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

/** 真实页头：与 Today.tsx 同构 */
const REAL = `<div class="app"><div class="hdr" id="hdr">
  <div><h1>今天</h1><div class="sub">减脂 · 1 餐 · 3 项</div></div>
  <span class="pill ok">剩 1426 kcal</span>
</div></div>`;

/** 现在的骨架页头（Loading.tsx 的静态版，无 React） */
const SK = `<div class="app"><div class="sk-page"><div class="sk-shapes">
  <div class="sk-hdr" id="skhdr">
    <div class="sk-hdcol"><span class="sk sk-h1"></span><span class="sk sk-sub"></span></div>
    <span class="sk sk-pill"></span>
  </div>
</div></div></div>`;

/** 方案 A 的主体：2 条 44 行 + 1 块 120 区块（不指向任何页面） */
const NEUTRAL = `<div class="app"><div class="sk-page"><div class="sk-shapes">
  <div class="sk-hdr" id="skhdr2">
    <div class="sk-hdcol"><span class="sk sk-h1"></span><span class="sk sk-sub"></span></div>
    <span class="sk sk-pill"></span>
  </div>
  <div class="sk-body" id="skbody">
    <div class="sk" style="height:44px;margin-top:12px"></div>
    <div class="sk" style="height:44px;margin-top:10px"></div>
    <div class="sk" style="height:120px;margin-top:10px"></div>
  </div>
  <div class="sk-tab" id="sktab"></div>
</div></div></div>`;

/**
 * 方案 A 修正版：`.sk-h1` 24 → 27.6、`.sk-sub` 17 → 17.4
 * 真 `.hdr` 左列 = h1 行盒（24 × 1.15 = 27.6）+ 3 + sub 行盒（12 × 1.45 = 17.4）= 48
 * 骨架原来按「24 + 3 + 17 = 44」算，整整差 3.98px。
 */
const NEUTRAL_FIX = `<style>.sk-h1{height:27.6px}.sk-sub{height:17.4px}</style>` + NEUTRAL;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

const rows = [];
for (const width of [320, 360, 390]) {
  for (const [label, html, sel] of [
    ['真实 .hdr', REAL, '#hdr'],
    ['骨架 .sk-hdr（现状）', SK, '#skhdr'],
    ['方案 A（含中性主体）', NEUTRAL, '#skhdr2'],
    ['方案 A 修正版（h1 27.6 / sub 17.4）', NEUTRAL_FIX, '#skhdr2'],
  ]) {
    await page.setViewport({ width, height: 568, deviceScaleFactor: 2 });
    await page.setContent(
      `<!doctype html><meta charset=utf-8><body style="margin:0;background:var(--bg)"><style>${css}</style>${html}</body>`,
      { waitUntil: 'load' },
    );
    const m = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const doc = document.scrollingElement;
      const app = document.querySelector('.app').getBoundingClientRect();
      const body = document.getElementById('skbody');
      return {
        h: +r.height.toFixed(2),
        appH: +app.height.toFixed(2),
        bodyH: body ? +body.getBoundingClientRect().height.toFixed(2) : null,
        scrollH: doc.scrollHeight,
        overflows: doc.scrollHeight > doc.clientHeight,
        viewH: window.innerHeight,
      };
    }, sel);
    rows.push({ w: width, label, ...m });
  }
}
await browser.close();

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
console.log('\n页头高度（像素）\n');
console.log(pad('宽度', 6) + pad('场景', 34) + pad('页头', 9) + pad('主体', 8) + pad('整屏高', 9) + '出滚动条');
console.log('-'.repeat(72));
for (const r of rows) {
  console.log(pad(r.w, 6) + pad(r.label, 34) + pad(r.h, 9) + pad(r.bodyH ?? '-', 8) + pad(r.appH, 9) + (r.overflows ? '是' : '否'));
}

console.log('\n页头差（骨架 − 真实）：');
const labels = [...new Set(rows.map((r) => r.label))].filter((l) => l !== '真实 .hdr');
for (const width of [320, 360, 390]) {
  const real = rows.find((r) => r.w === width && r.label === '真实 .hdr');
  for (const l of labels) {
    const s = rows.find((r) => r.w === width && r.label === l);
    const d = +(s.h - real.h).toFixed(2);
    console.log(`  ${width}px ${pad(l, 34)} ${real.h} vs ${s.h} → ${d > 0 ? '+' : ''}${d}px ${Math.abs(d) <= 2 ? '✅ ≤2' : '✗ 超 2px'}`);
  }
}
