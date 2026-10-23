/**
 * 今日页圆环的视觉回归：数字必须落在圆心上，而不是"数字+两行小字"整体居中。
 * 用法：先起 vite preview --port 4173，再 node tools/shoot-ring.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:4173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '.shots');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
await wait(1200);

// 塞两餐今天的数据，让环上有进度
await page.evaluate(async (day) => {
  const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium', 'potassium',
    'calcium', 'iron', 'zinc', 'selenium', 'magnesium', 'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin'];
  const facts = (kcal) => Object.fromEntries(keys.map((k) => [k, k === 'kcal' ? kcal : 1]));
  const mk = (id, name, kcal, slot) => ({
    id, date: day, eatenAt: Date.now(), slot, source: 'manual', photoId: null,
    items: [{ id: `${id}_i`, name, rawName: null, parentDish: null, foodId: null, matchType: 'manual',
      matchScore: null, grams: 200, baseG: 200, portionTier: 'medium', tierConfirmed: false,
      quantity: null, unit: null, gramSource: 'user', per100g: facts(kcal / 2),
      nutrition: facts(kcal), fieldSource: {}, components: null, confidence: 1, locked: false }],
    totals: facts(kcal), coverage: { kcal: 1 }, goalId: null, aiMeta: null,
    createdAt: Date.now(), deletedAt: null,
  });
  const db = await new Promise((res) => {
    const r = indexedDB.open('daily-intake');
    r.onsuccess = () => res(r.result);
  });
  await new Promise((res) => {
    const tx = db.transaction('meals', 'readwrite');
    tx.objectStore('meals').put(mk('m1', '早餐', 425, 'breakfast'));
    tx.objectStore('meals').put(mk('m2', '午餐', 680, 'lunch'));
    tx.oncomplete = res;
  });
}, new Date().toISOString().slice(0, 10));

await page.reload({ waitUntil: 'networkidle2' });
await wait(1500);

// 量一下：数字盒子的中心 vs 圆环 svg 的中心
const geo = await page.evaluate(() => {
  const svg = document.querySelector('.ringwrap svg');
  const big = document.querySelector('.ring-center .big');
  if (!svg || !big) return null;
  const s = svg.getBoundingClientRect();
  const b = big.getBoundingClientRect();
  return {
    svgCx: Math.round(s.left + s.width / 2), svgCy: Math.round(s.top + s.height / 2),
    bigCx: Math.round(b.left + b.width / 2), bigCy: Math.round(b.top + b.height / 2),
    text: document.querySelector('.ring-center')?.innerText.replace(/\n/g, ' | '),
  };
});
console.log('几何：', geo);
if (geo) {
  console.log(`数字中心相对圆环中心：dx=${geo.bigCx - geo.svgCx}px, dy=${geo.bigCy - geo.svgCy}px`);
}

await page.screenshot({ path: resolve(OUT, 'today-ring.png') });
console.log('已截图', resolve(OUT, 'today-ring.png'));
await browser.close();
