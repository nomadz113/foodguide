/**
 * 图标验收预览：把真实密度尺寸放在白/深两种桌面上看实际效果。
 *
 * 直接复用 public/ 里已生成的 PNG，不重新画 —— 看的是落地结果不是设计稿。
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const OUT = resolve(import.meta.dirname, '../../design/icon-sizes.png');
// file:// 在 headless 下加载不稳，直接内嵌
const SRC = `data:image/png;base64,${readFileSync(
  resolve(import.meta.dirname, '../public/icon-512.png'),
).toString('base64')}`;
const SIZES = [48, 72, 96, 144, 192]; // mdpi~xxxhdpi 的真实 48dp 对应像素
const DESKS = [
  ['白色桌面', '#ffffff'],
  ['深色桌面', '#12161a'],
];

const rows = DESKS.map(
  ([label, bg]) => `
  <div class="row" style="background:${bg}">
    <div class="lb">${label}</div>
    ${SIZES.map(
      (n) =>
        `<div class="cell"><img src="${SRC}" width="${n}" height="${n}"><span>${n}px</span></div>`,
    ).join('')}
  </div>`,
).join('');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;font-family:"Microsoft YaHei",sans-serif}
  .row{display:flex;align-items:center;gap:28px;padding:24px 28px}
  .lb{width:80px;font-size:14px;font-weight:600;color:#888}
  .cell{display:flex;flex-direction:column;align-items:center;gap:6px}
  .cell span{font-size:12px;color:#888}
  img{display:block}
</style></head><body>${rows}</body></html>`;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
const args = [
  '--allow-file-access-from-files',
  '--disable-web-security',
];
await page.setViewport({ width: 1100, height: 560, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log('icon sizes ->', OUT);
