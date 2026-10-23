/**
 * 界面截图脚本（开发辅助，不参与构建）。
 *
 * 为什么不用 chrome --screenshot：headless 的 --virtual-time-budget 会在
 * IndexedDB 回调返回前就截图，页面永远停在「正在准备本地数据」。
 * 这里走 CDP 真实等待首屏渲染完成，并能捕获 console 错误。
 *
 * 每次运行都是全新的浏览器 profile，所以 IndexedDB 是空的，截图结果可复现。
 * 用法：node tools/shoot.mjs [baseUrl] [outDir]
 */

import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'C:/Users/Admin/Desktop/每日摄入指南/shots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) console.log('[console.error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

async function shot(name) {
  await sleep(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('OK', name);
}

async function go(hash, wait) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle2', timeout: 30000 });
  try {
    await page.waitForSelector(wait, { timeout: 15000 });
  } catch {
    console.log(`[warn] 未等到 ${wait}`);
  }
}

// ── 1. 空状态 ──
await go('#/', '.ringwrap');
await shot('01-today-empty');

// ── 2. 记一餐：搜索 → 加入 → 切大份 ──
await page.click('.tabbar .fab button');
await page.waitForSelector('.searchbox');
await shot('02-add');

async function addFood(name, tier) {
  await page.click('.searchbox input', { clickCount: 3 });
  await page.type('.searchbox input', name);
  await page.waitForSelector('.pickrow', { timeout: 8000 });
  await page.click('.pickrow .add');
  await sleep(150);
  if (tier) {
    const sel = '.selitem:last-of-type .tiers3 button:nth-child(' + (tier === 'large' ? 3 : tier === 'small' ? 1 : 2) + ')';
    await page.click(sel);
    await sleep(120);
  }
}

await addFood('米饭', 'large');
await addFood('鸡胸肉');
await shot('03-add-selected');
await addFood('大豆油');
await page.click('.sheetbar button.primary');
await sleep(600);

// ── 3. 有数据的今日页 ──
await go('#/', '.ringwrap');
await shot('04-today');

// ── 4. 档案页 ──
await go('#/profile', '.big');
await shot('05-profile');
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => {
  const m = document.querySelector('.main');
  if (m) m.scrollTop = 9999;
});
await shot('06-profile-bottom');

// ── 5. 统计页 ──
await go('#/stats', '.bars');
await shot('07-stats');

// ── 6. 设置页 ──
await go('#/settings', '.seg');
await shot('08-settings');

await browser.close();
