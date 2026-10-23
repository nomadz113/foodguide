/**
 * 编辑一餐 + 宏量进度条 的端到端验证。
 *
 * 两件事必须真跑浏览器才算数：
 *   1) 进度条是 CSS 坑（inline span 的 width 无效），只有量出真实宽度才知道有没有修好；
 *   2) 编辑页改完克数必须真的落到库里，且整餐合计跟着变 —— 单测覆盖了纯函数，
 *      覆盖不了「页面按钮 → 写库 → 今日页数字」这条链。
 *
 * 用法：先起 vite preview --port 4173，再 node tools/check-meal-edit.mjs
 */
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '.shots');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const checkTrue = (name, got) => check(name, !!got, true);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
page.on('dialog', (d) => d.accept());

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
await wait(1200);

await page.evaluate(async (day) => {
  const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium', 'potassium',
    'calcium', 'iron', 'zinc', 'selenium', 'magnesium', 'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin'];
  const mkFacts = (v) => Object.fromEntries(keys.map((k) => [k, v[k] ?? null]));
  const per100 = mkFacts({ kcal: 116, protein: 12, fat: 30, carbs: 40 });
  const item = {
    id: 'i1', name: '测试米饭', rawName: null, parentDish: null, foodId: null,
    matchType: 'manual', matchScore: null, grams: 200, baseG: 200, portionTier: 'medium',
    tierConfirmed: false, quantity: null, unit: null, gramSource: 'user',
    per100g: per100,
    nutrition: mkFacts({ kcal: 232, protein: 24, fat: 60, carbs: 80 }),
    fieldSource: {}, components: null, confidence: 1, locked: false,
  };
  const meal = {
    id: 'meal_edit_test', date: day, eatenAt: Date.now(), slot: 'lunch',
    source: 'manual', photoId: null, items: [item],
    totals: mkFacts({ kcal: 232, protein: 24, fat: 60, carbs: 80 }),
    coverage: { kcal: 1 }, goalId: null, aiMeta: null, createdAt: Date.now(), deletedAt: null,
  };
  const db = await new Promise((res) => {
    const r = indexedDB.open('daily-intake');
    r.onsuccess = () => res(r.result);
  });
  await new Promise((res) => {
    const tx = db.transaction('meals', 'readwrite');
    tx.objectStore('meals').put(meal);
    tx.oncomplete = res;
  });
}, new Date().toISOString().slice(0, 10));

await page.reload({ waitUntil: 'networkidle2' });
await wait(1500);

// 1) 宏量进度条必须有宽度（曾经因为 inline span 整条消失）
const bars = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.mrow')];
  return rows.map((r) => {
    const t = r.querySelector('.track')?.getBoundingClientRect();
    const f = r.querySelector('.fill')?.getBoundingClientRect();
    return { lbl: r.querySelector('.lbl')?.textContent, track: Math.round(t?.width ?? 0), fill: Math.round(f?.width ?? 0) };
  });
});
console.log('  宏量条：', JSON.stringify(bars));
check('宏量条有 3 行', bars.length, 3);
checkTrue('轨道宽度正常（>100px）', bars.every((b) => b.track > 100));
checkTrue('填充条可见（有宽度）', bars.every((b) => b.fill > 0));
await page.screenshot({ path: resolve(OUT, 'today-macros.png'), fullPage: true });

// 2) 每餐有编辑入口，点进去
checkTrue('今日页有编辑按钮', await page.evaluate(() => !!document.querySelector('.meal .edit')));
await page.evaluate(() => document.querySelector('.meal .edit')?.click());
await wait(900);
const hash = await page.evaluate(() => location.hash);
checkTrue(`点✎进入编辑页（${hash}）`, hash.startsWith('#/meal/'));
checkTrue('编辑页有底部导航（不是死胡同）', await page.evaluate(() => !!document.querySelector('.tabbar')));

// 用餐时间必须带出实际时间，否则用户一保存就把这餐挪到 00:00 了
const clockNow = new Date();
const wantClock = `${String(clockNow.getHours()).padStart(2, '0')}:${String(clockNow.getMinutes()).padStart(2, '0')}`;
const timeVal = await page.evaluate(() => document.querySelector('input[type=time]')?.value);
check('用餐时间带出实际时间', timeVal, wantClock);
await page.screenshot({ path: resolve(OUT, 'meal-edit.png'), fullPage: true });

// 3) 改克数：+ 两次（step = 10）
const before = await page.evaluate(() => document.querySelector('.selitem .stepper b')?.textContent);
await page.evaluate(() => {
  const plus = document.querySelectorAll('.selitem .stepper button')[1];
  plus?.click();
});
await wait(250);
await page.evaluate(() => {
  const plus = document.querySelectorAll('.selitem .stepper button')[1];
  plus?.click();
});
await wait(400);
const after = await page.evaluate(() => document.querySelector('.selitem .stepper b')?.textContent);
check('改克数前', before, '200g');
check('点两次 + 后', after, '220g');

const kcalShown = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('改后合计'));
  return card?.querySelector('.v')?.textContent?.replace(/\D/g, '') ?? 'none';
});
checkTrue(`合计跟着变（${kcalShown} kcal，原 232）`, Number(kcalShown) > 232);

// 4) 保存并回今日页，库里必须真的变了
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click();
});
await wait(1500);
check('保存后回到今日页', await page.evaluate(() => location.hash), '#/');

const stored = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('daily-intake');
    r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const tx = db.transaction('meals', 'readonly');
    const q = tx.objectStore('meals').get('meal_edit_test');
    q.onsuccess = () => res({ grams: q.result?.items[0]?.grams, kcal: q.result?.totals?.kcal });
  });
});
check('库里的克数已改', stored.grams, 220);
checkTrue(`整餐合计已重算（${Math.round(stored.kcal)} kcal）`, Math.abs(stored.kcal - 255) < 3);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (errors.length) console.log('页面错误：', errors.slice(0, 5));
if (failed.length || errors.length) process.exitCode = 1;
await browser.close();
