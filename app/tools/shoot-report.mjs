/**
 * 进度页验收截图（开发辅助，不参与构建）。
 *
 * 单日页面靠 UI 点几下就能造出数据，但周/月/季报告需要 30 天、几十条记录 + 十几次称重，
 * 手点不现实。所以这里直接往 IndexedDB 里写符合真实结构的行，
 * 让页面走它本来就会走的那条渲染路径 —— 不是 mock 组件，是真的读写库。
 *
 * 数据刻意做成「有故事」的样子：
 *  - 每周漏记 1 天（覆盖率 86%），验证「记录不足」不会误报成吃得少
 *  - 周末多吃（验证规律识别）
 *  - 体重下降比理论慢（验证「摄入被低估」判定）
 *  - 维 C / 钙长期不足（验证缺口榜）
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
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text());
});
page.on('pageerror', (e) => errs.push(e.message));

// 先启动一次，让 App 建库、灌种子、算目标
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('.ringwrap', { timeout: 20000 });

const seeded = await page.evaluate(async () => {
  const pad = (n) => String(n).padStart(2, '0');
  const dayKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium', 'potassium',
    'calcium', 'iron', 'zinc', 'selenium', 'magnesium', 'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin'];

  function facts(values) {
    const o = {};
    for (const k of KEYS) o[k] = null;
    return { ...o, ...values };
  }

  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('daily-intake');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const today = new Date();
  const meals = [];
  const weights = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = dayKeyOf(d);
    const dow = d.getDay();

    // 每周固定漏记一天：覆盖率不足的情形必须能验证出来
    if (i % 7 === 5) continue;

    const weekend = dow === 0 || dow === 6;
    const target = 1900;
    const noise = Math.round(Math.sin(i * 1.7) * 90);
    // 日常略低于目标、周末多吃：这样达标天数、周末规律、理论缺口三者能自洽
    const kcal = target - 90 + noise + (weekend ? 240 : 0);
    const protein = 118 + Math.round(Math.sin(i * 0.6) * 16);

    // 三餐按 3:4:3 分配，营养素按比例切分
    const split = [0.3, 0.4, 0.3];
    const slots = ['breakfast', 'lunch', 'dinner'];
    split.forEach((ratio, idx) => {
      const g = 200 + idx * 20;
      const micro = {
        // 维 C 与钙长期不足，其余接近目标
        vc: (38 / 3) * ratio * 3,
        calcium: (560 / 3) * ratio * 3,
        iron: (11 / 3) * ratio * 3,
        zinc: (11 / 3) * ratio * 3,
        selenium: (55 / 3) * ratio * 3,
        potassium: (1900 / 3) * ratio * 3,
        magnesium: (310 / 3) * ratio * 3,
        va: (760 / 3) * ratio * 3,
        vd: (7 / 3) * ratio * 3,
        ve: (13 / 3) * ratio * 3,
        b1: (1.3 / 3) * ratio * 3,
        b2: (1.3 / 3) * ratio * 3,
        niacin: (14 / 3) * ratio * 3,
        sugar: 6,
        sodium: ((weekend ? 2600 : 1800) / 3) * ratio * 3,
      };
      const per100g = facts({
        kcal: kcal / 3 / (g / 100),
        protein: (protein / 3) / (g / 100),
        fat: (kcal * 0.3 / 9 / 3) / (g / 100),
        carbs: (kcal * 0.45 / 4 / 3) / (g / 100),
        fiber: (20 / 3) / (g / 100),
        ...Object.fromEntries(Object.entries(micro).map(([k, v]) => [k, v / (g / 100)])),
      });
      const nutrition = facts(
        Object.fromEntries(KEYS.map((k) => [k, per100g[k] == null ? null : per100g[k] * (g / 100)])),
      );

      meals.push({
        id: `seed_${date}_${idx}`,
        date,
        eatenAt: d.getTime() + (8 + idx * 5) * 3600_000,
        slot: slots[idx],
        source: 'manual',
        photoId: null,
        items: [{
          id: `seed_${date}_${idx}_i0`,
          name: ['全麦面包+鸡蛋', '米饭+鸡胸肉+青菜', '杂粮饭+牛肉+西兰花'][idx],
          rawName: null,
          parentDish: null,
          foodId: null,
          matchType: 'library',
          matchScore: 1,
          grams: g,
          baseG: g,
          portionTier: 'medium',
          tierConfirmed: false,
          quantity: null,
          unit: null,
          gramSource: 'library',
          per100g,
          nutrition,
          fieldSource: {},
          components: null,
          confidence: 0.9,
          locked: false,
        }],
        totals: nutrition,
        coverage: facts(Object.fromEntries(KEYS.map((k) => [k, 1]))),
        goalId: null,
        aiMeta: null,
        createdAt: d.getTime(),
        deletedAt: null,
      });
    });

    // 每 3 天称一次，30 天降约 0.35kg，叠加 ±0.25kg 水分波动（验证移动平均能压住噪声）
    if (i % 3 === 0) {
      weights.push({
        id: `seed_w_${date}`,
        date,
        weightKg: Number((78.4 - (29 - i) * 0.012 + Math.sin(i) * 0.25).toFixed(1)),
        bodyFatPct: null,
        waistCm: null,
        note: null,
        createdAt: d.getTime(),
      });
    }
  }

  // weights 的 date 是唯一索引：App 启动时可能已经写入今天这一条。
  // 必须在写事务之前查清楚，不能在事务里 await —— 事务一旦没有挂起请求就会自动提交。
  const existingDates = new Set(
    await new Promise((res, rej) => {
      const tx = db.transaction(['weights'], 'readonly');
      const q = tx.objectStore('weights').getAll();
      q.onsuccess = () => res(q.result.map((w) => w.date));
      q.onerror = () => rej(new Error('读取已有称重失败'));
    }),
  );
  // 已有日期的称重（App 启动时按档案写的那条）也要改成趋势值，
  // 否则「今天 78.0 / 前天 77.1」会让周期对比凭空多出 0.9kg
  const existing = await new Promise((res, rej) => {
    const tx = db.transaction(['weights'], 'readonly');
    const q = tx.objectStore('weights').getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(new Error('读取称重失败'));
  });
  const byDate = new Map(existing.map((w) => [w.date, w]));
  const weightRows = weights.map((w) => {
    const old = byDate.get(w.date);
    return old ? { ...old, weightKg: w.weightKg, createdAt: w.createdAt } : w;
  });

  await new Promise((res, rej) => {
    const tx = db.transaction(['meals', 'weights'], 'readwrite');
    tx.oncomplete = () => res();
    tx.onerror = (e) => rej(new Error(`事务失败: ${e.target?.error?.message ?? tx.error ?? '未知'}`));
    tx.onabort = () => rej(new Error('事务被中止'));
    for (const m of meals) tx.objectStore('meals').put(m);
    for (const w of weightRows) tx.objectStore('weights').put(w);
  });
  db.close();
  return { meals: meals.length, weights: weights.length };
});
console.log(`已写入 ${seeded.meals} 条餐次、${seeded.weights} 次称重`);

async function shot(name, scroll = 0) {
  if (scroll > 0) {
    // 滚动发生在 .main 容器上，不是 window —— 整个 App 是固定视口的
    await page.evaluate((y) => {
      const m = document.querySelector('.main');
      if (m) m.scrollTop = y; else window.scrollTo(0, y);
    }, scroll);
    await sleep(400);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('OK', name);
}

async function openStats() {
  await page.goto(`${BASE}/#/stats`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.chart-bars', { timeout: 15000 });
  await sleep(500);
}

await openStats();
await shot('40-report-week');

// 柱高与目标线的几何自检：柱子高度必须与热量成比例，目标线必须落在目标值处
const geo = await page.evaluate(() => {
  const box = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height) }; };
  const chart = box(document.querySelector('.chart-bars'));
  return {
    chart,
    bars: [...document.querySelectorAll('.cbar')].map((x) => ({ ...box(x), style: x.getAttribute('style') })),
    target: (() => { const t = document.querySelector('.ctarget'); return t ? { ...box(t), style: t.getAttribute('style') } : null; })(),
  };
});
console.log('几何:', JSON.stringify(geo));

await shot('41-report-week-2', 760);

// 切到月
await page.evaluate(() => {
  [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === '月')?.click();
});
await sleep(600);
await shot('42-report-month');

// 切到季
await page.evaluate(() => {
  [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === '季')?.click();
});
await sleep(600);
await shot('43-report-quarter');

// 抓一份真实数字，用来核对界面与引擎是否一致
const summary = await page.evaluate(() => ({
  head: document.querySelector('.hdr .sub')?.textContent?.trim(),
  rows: [...document.querySelectorAll('.krow')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  tv: [...document.querySelectorAll('.tv-cell')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  verdict: document.querySelector('.verdict')?.textContent?.replace(/\s+/g, ' ').trim(),
  gaps: [...document.querySelectorAll('.gaprow')].map((g) => g.textContent.replace(/\s+/g, ' ').trim()),
  bars: document.querySelectorAll('.cbar').length,
}));
console.log(JSON.stringify(summary, null, 1));
if (errs.length) console.log('控制台错误:', errs.slice(0, 5));

await browser.close();
