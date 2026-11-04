/**
 * 柱内数字 vs 目标虚线：切缝到底切到谁。
 *
 * 争的那件事：`.ctarget` 加了 `box-shadow: 0 0 0 1px var(--card)`（1px 切缝），
 * 而 `.cval` 是 z-index: 3、虚线是 2 —— 按理数字该盖住虚线。
 * 但「按理」不算证据：`.cbar` 是 position: relative + z-index: auto，
 * 一旦它在某处形成了层叠上下文，3 和 2 就不在同一个上下文里比较，结论会反。
 *
 * 所以这里做两件事：
 *   1. 把 DOM 链上每一层的 position / z-index 打出来，确认没有意外的层叠上下文；
 *   2. 造一根「柱顶刚好在目标线上方 15px」的柱子（数字带正好压在虚线上），
 *      用 4× 设备像素截图，直接看渲染结果。
 *
 * 用法：npm run build && npx vite preview --port 4173 &
 *       node tools/probe-cval-slit.mjs
 * 产物：shots/probe-cval-slit.png（4× 放大的柱顶）
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { completeOnboarding } from './lib/onboard.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = resolve(import.meta.dirname, '../shots');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一条总热量 2,679 kcal 的餐 —— 与 v2-09 那张「超限」截图同一个数 */
function seedMeal(nowMs, kcal) {
  const d = new Date(nowMs);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const facts = (o = {}) => ({
    kcal: null, protein: null, fat: null, carbs: null, fiber: null, sugar: null,
    sodium: null, potassium: null, calcium: null, iron: null, zinc: null,
    selenium: null, magnesium: null, va: null, vc: null, vd: null, ve: null,
    b1: null, b2: null, niacin: null, ...o,
  });
  const item = {
    id: 'item_probe', name: '压力测试餐', foodId: null, matchType: 'ai',
    rawName: null, parentDish: null, matchScore: null, portionTier: 'medium',
    tierConfirmed: false, grams: 100, baseG: 100, quantity: null, unit: null,
    gramSource: 'ai', components: null, confidence: 0.9, locked: false,
    per100g: facts({ kcal }), nutrition: facts({ kcal }),
    fieldSource: {},
  };
  return {
    id: 'meal_probe_cval', date, eatenAt: nowMs, slot: 'lunch', source: 'manual',
    photoId: null, items: [item], totals: facts({ kcal }), coverage: {}, goalId: null,
    aiMeta: null, createdAt: nowMs, deletedAt: null,
  };
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 4 },
});
const page = await browser.newPage();
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('.app, .welcome', { timeout: 20000 });
if (await page.evaluate(() => Boolean(document.querySelector('.welcome')))) {
  await completeOnboarding(page, { wait });
}
await page.waitForSelector('.tabbar', { timeout: 20000 });

// 目标 2248 × 1.192 = 2679：柱顶在目标线上方 16%（96px 里的 15.5px），
// 而数字带是 top 4 ~ 16 —— 正好落在虚线上，这是最坏的撞线情形。
// 目标值直接从今日页读（goals 表的主键是 goal_* 的字符串，硬编码 key 拿不到）
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.ringwrap', { timeout: 20000 });
await wait(400);
const goalKcal = await page.evaluate(() => {
  const m = document.body.innerText.match(/目标\s*([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
});
if (!goalKcal) throw new Error('读不到目标热量，先跑一遍引导');
const kcal = Math.round(goalKcal * (1 + 16 / 96 / (1 - 0.161))); // ≈ +19%

await page.evaluate(async (meal) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('daily-intake');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('meals', 'readwrite');
    tx.objectStore('meals').put(meal);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  db.close();
}, seedMeal(Date.now(), kcal));

await page.goto(`${BASE}/#/stats`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.chart-bars', { timeout: 20000 });
await wait(600);

const geo = await page.evaluate(() => {
  const cval = document.querySelector('.cval');
  const target = document.querySelector('.ctarget');
  const bar = document.querySelector('.cbar:not(.none)');
  if (!cval || !target || !bar) return { missing: true };
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), height: +b.height.toFixed(1) };
  };
  // DOM 链：cval → ... → .chart-bars，逐层 position / z-index
  const chain = [];
  for (let el = cval; el && !el.classList.contains('chart-bars'); el = el.parentElement) {
    const cs = getComputedStyle(el);
    chain.push({
      cls: el.className || el.tagName,
      position: cs.position,
      zIndex: cs.zIndex,
      opacity: cs.opacity,
      transform: cs.transform,
      filter: cs.filter,
    });
  }
  return {
    cvalText: cval.textContent,
    cval: r(cval),
    target: r(target),
    bar: r(bar),
    overlap: !(cval.bottom <= target.top || cval.top >= target.bottom),
    zCval: getComputedStyle(cval).zIndex,
    zTarget: getComputedStyle(target).zIndex,
    targetShadow: getComputedStyle(target).boxShadow,
    chain,
  };
});

console.log(JSON.stringify(geo, null, 2));

const box = await page.evaluate(() => {
  const chart = document.querySelector('.chart-bars').getBoundingClientRect();
  return { x: chart.x, y: chart.y, width: chart.width, height: chart.height };
});
await page.screenshot({
  path: resolve(OUT, 'probe-cval-slit.png'),
  clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 96) },
});
console.log('OK shots/probe-cval-slit.png');
await browser.close();
