/**
 * 验收页截图检查：把 photo-audit.html 渲染出来，确认 6 张照片真的加载成功。
 * 用法：node tools/shot-audit.mjs
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const PAGE = `file:///${resolve(ROOT, 'photo-audit.html').replace(/\\/g, '/')}`;
const OUT = resolve(ROOT, 'shots');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 1180, height: 1240, deviceScaleFactor: 1.4 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 200));
});

await page.goto(PAGE, { waitUntil: 'networkidle2' });
const info = await page.evaluate(() => ({
  imgs: [...document.images].map((i) => ({ ok: i.naturalWidth > 0, w: i.naturalWidth, src: i.src.split('/').pop() })),
  h: document.body.scrollHeight,
}));
console.log('图片:', info.imgs.map((i) => (i.ok ? `OK ${i.w}px` : `FAIL ${i.src}`)).join('  '));
console.log('页面高度:', info.h);
console.log('错误:', errs.length ? errs : '无');

await page.screenshot({ path: `${OUT}/20-audit-top.png` });
await page.screenshot({ path: `${OUT}/21-audit-full.png`, fullPage: true });
await browser.close();
