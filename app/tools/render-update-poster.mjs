/**
 * 更新一览海报渲染（朋友圈用）。
 *
 * 改版本范围或文案 → 只动 `poster-091-096.html`（纯 HTML/CSS），本脚本不用改。
 * 走真实浏览器渲染而不是拼图：字体回退、行高、中文断行都是最终像素，
 * 图上写错一个字就是发出去之后才发现的错。
 *
 * 跑法：npm run preview 不需要，直接 `node tools/render-update-poster.mjs`
 * 产物：项目根 `好好吃饭-091-096-更新一览.png`（1080 宽，手机全屏看足够锐利）
 * 副产物：shots/poster-*.png 局部原图，用来核对断行（缩略图看不出断字）
 */
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const SRC = resolve('tools/poster-091-096.html');
const OUT = resolve('..', '好好吃饭-091-096-更新一览.png');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 1080, height: 1600, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`C:${m.text()}`); });

await page.goto(pathToFileURL(SRC).href, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

const box = await page.evaluate(() => {
  const d = document.documentElement;
  return { w: d.scrollWidth, h: d.scrollHeight };
});
await page.setViewport({ width: 1080, height: box.h, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: OUT, fullPage: true });

// 局部原图：整图缩到 400 宽看不出断行，交给人工看这两块
const clipOf = async (sel, name) => {
  const el = await page.$(sel);
  if (!el) return;
  const b = await el.boundingBox();
  await page.screenshot({ path: resolve('shots', name), clip: b });
};
await clipOf('header', 'poster-head.png');
await clipOf('.timeline .item:nth-child(1)', 'poster-p1.png');
  await clipOf('.timeline .item:nth-child(2)', 'poster-p2.png');
  await clipOf('.timeline .item:nth-child(3)', 'poster-p3.png');
  await clipOf('.timeline .item:nth-child(4)', 'poster-p4.png');
await clipOf('.timeline .item:nth-child(5)', 'poster-p5.png');
try{await clipOf('footer', 'poster-foot.png');}catch(e){}

console.log(`输出 ${OUT}`);
console.log(`尺寸 ${box.w} × ${box.h}（1080 宽，手机全屏看足够）`);
console.log(`报错 ${errs.length ? errs.slice(0, 3).join(' | ') : '无'}`);
await browser.close();
