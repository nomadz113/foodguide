/**
 * 产品介绍图用的截图（开发辅助，不参与构建）。
 *
 * 与 shoot*.mjs 的区别：那些是「验收」，看功能对不对；这个只管「好看且真实」——
 * 数据仍然走真实的 IndexedDB 写入 + 真实渲染路径，不 mock 组件。
 *
 * 做了两件事：
 *  1. 今天写 4 餐、每餐 2~3 条，用真菜名，热量贴近目标（圆环有颜色、宏量条有长度）
 *  2. 往前 29 天按「有故事」的方式造：每周漏记 1 天、周末多吃、维 C/钙长期不足
 *
 * 用法：node tools/shoot-promo.mjs [baseUrl] [outDir]
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? resolve(import.meta.dirname, '../promo/shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 3 },
});
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('.ringwrap', { timeout: 20000 });

const seeded = await page.evaluate(async () => {
  const pad = (n) => String(n).padStart(2, '0');
  const dayKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium', 'potassium',
    'calcium', 'iron', 'zinc', 'selenium', 'magnesium', 'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin'];
  const facts = (v = {}) => ({ ...Object.fromEntries(KEYS.map((k) => [k, null])), ...v });

  /** 一条 item：给总量 + 克数，反推 per100g（库内统一 per100g） */
  function item(name, grams, values) {
    const n = facts(values);
    const per100g = facts(Object.fromEntries(
      KEYS.map((k) => [k, n[k] == null ? null : (n[k] * 100) / grams]),
    ));
    return { n, per100g };
  }

  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('daily-intake');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const today = new Date();
  const meals = [];
  const weights = [];

  // ── 今天：4 餐 11 条，热量 1673 / 目标 1902，钠 1560 / 2000（余量条不满不爆）
  const TODAY = [
    ['breakfast', 8, [
      ['全麦吐司', 70, { kcal: 175, protein: 7, fat: 2.4, carbs: 32, fiber: 4.2, sugar: 2.1, sodium: 240, potassium: 180, calcium: 42, iron: 1.6, zinc: 0.9, selenium: 6, magnesium: 60, va: 0, vc: 0, vd: 0, ve: 1.2, b1: 0.22, b2: 0.12, niacin: 2.4 }],
      ['水煮蛋', 50, { kcal: 72, protein: 6.4, fat: 4.8, carbs: 0.6, fiber: 0, sugar: 0.3, sodium: 62, potassium: 76, calcium: 28, iron: 1.1, zinc: 0.7, selenium: 7.3, magnesium: 6, va: 78, vc: 0, vd: 1.1, ve: 0.7, b1: 0.04, b2: 0.22, niacin: 0.2 }],
      ['无糖豆浆', 300, { kcal: 93, protein: 9, fat: 5.4, carbs: 3.3, fiber: 1.2, sugar: 1.5, sodium: 12, potassium: 360, calcium: 45, iron: 1.8, zinc: 0.6, selenium: 3, magnesium: 45, va: 0, vc: 0, vd: 0, ve: 0.9, b1: 0.09, b2: 0.06, niacin: 0.6 }],
    ]],
    ['lunch', 12, [
      ['米饭', 200, { kcal: 232, protein: 5.2, fat: 0.6, carbs: 51.6, fiber: 0.6, sugar: 0.2, sodium: 4, potassium: 60, calcium: 6, iron: 0.5, zinc: 1.1, selenium: 5, magnesium: 20, va: 0, vc: 0, vd: 0, ve: 0.2, b1: 0.04, b2: 0.03, niacin: 0.8 }],
      ['香煎鸡胸肉', 150, { kcal: 246, protein: 41, fat: 8.2, carbs: 0, fiber: 0, sugar: 0, sodium: 340, potassium: 500, calcium: 12, iron: 1.2, zinc: 1.5, selenium: 30, magnesium: 45, va: 9, vc: 0, vd: 0.1, ve: 0.9, b1: 0.11, b2: 0.15, niacin: 15.6 }],
      ['清炒西兰花', 160, { kcal: 96, protein: 6.4, fat: 5.1, carbs: 6.2, fiber: 3.4, sugar: 2.4, sodium: 300, potassium: 470, calcium: 96, iron: 1.6, zinc: 0.7, selenium: 1.6, magnesium: 38, va: 55, vc: 88, vd: 0, ve: 2.1, b1: 0.11, b2: 0.15, niacin: 1.3 }],
    ]],
    ['dinner', 18, [
      ['杂粮饭', 180, { kcal: 208, protein: 6.9, fat: 1.4, carbs: 42, fiber: 3.1, sugar: 0.4, sodium: 6, potassium: 240, calcium: 20, iron: 1.3, zinc: 1.4, selenium: 6, magnesium: 78, va: 0, vc: 0, vd: 0, ve: 0.8, b1: 0.16, b2: 0.07, niacin: 1.9 }],
      ['清蒸鲈鱼', 150, { kcal: 157, protein: 27, fat: 4.8, carbs: 0.5, fiber: 0, sugar: 0, sodium: 380, potassium: 420, calcium: 90, iron: 1.5, zinc: 1.1, selenium: 38, magnesium: 50, va: 12, vc: 0, vd: 6.8, ve: 1.3, b1: 0.05, b2: 0.2, niacin: 4.2 }],
      ['凉拌菠菜', 120, { kcal: 78, protein: 3.4, fat: 4.6, carbs: 4.1, fiber: 2.2, sugar: 1.1, sodium: 320, potassium: 400, calcium: 96, iron: 3.2, zinc: 0.6, selenium: 1.1, magnesium: 68, va: 450, vc: 22, vd: 0, ve: 2.4, b1: 0.06, b2: 0.13, niacin: 0.7 }],
    ]],
    ['snack', 21, [
      ['苹果', 200, { kcal: 104, protein: 0.4, fat: 0.4, carbs: 27, fiber: 3.2, sugar: 21, sodium: 2, potassium: 238, calcium: 8, iron: 0.2, zinc: 0.1, selenium: 0.2, magnesium: 10, va: 6, vc: 9.2, vd: 0, ve: 0.4, b1: 0.04, b2: 0.04, niacin: 0.2 }],
      ['无糖希腊酸奶', 150, { kcal: 88, protein: 14, fat: 0.6, carbs: 5.4, fiber: 0, sugar: 5.1, sodium: 54, potassium: 210, calcium: 160, iron: 0.1, zinc: 0.8, selenium: 15, magnesium: 16, va: 3, vc: 0, vd: 0.1, ve: 0, b1: 0.05, b2: 0.3, niacin: 0.3 }],
    ]],
  ];

  const todayKey = dayKeyOf(today);
  const slotName = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
  TODAY.forEach(([slot, hour, list], idx) => {
    const built = list.map(([name, g, v], i) => {
      const { n, per100g } = item(name, g, v);
      return {
        id: `p_${todayKey}_${idx}_${i}`, name, rawName: null, parentDish: null, foodId: null,
        matchType: 'library', matchScore: 0.94, grams: g, baseG: g, portionTier: 'medium',
        tierConfirmed: true, quantity: null, unit: null, gramSource: 'library',
        per100g, nutrition: n, fieldSource: {}, components: null, confidence: 0.92, locked: false,
      };
    });
    const totals = facts(Object.fromEntries(
      KEYS.map((k) => [k, built.some((b) => b.nutrition[k] != null)
        ? built.reduce((s, b) => s + (b.nutrition[k] ?? 0), 0)
        : null]),
    ));
    const coverage = facts(Object.fromEntries(
      KEYS.map((k) => [k, built.filter((b) => b.nutrition[k] != null).length / built.length]),
    ));
    meals.push({
      id: `p_${todayKey}_${idx}`, date: todayKey,
      eatenAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, 20).getTime(),
      slot, source: idx === 1 ? 'photo' : 'manual', photoId: null,
      items: built, totals, coverage, goalId: null, aiMeta: null,
      createdAt: today.getTime() + idx, deletedAt: null,
    });
  });
  void slotName;

  // ── 往前 29 天：每周漏 1 天（覆盖率 86%）、周末多吃、维 C/钙长期不足
  const ratio3 = [0.28, 0.44, 0.28];
  for (let i = 29; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = dayKeyOf(d);
    if (i % 7 === 5) continue;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const noise = Math.round(Math.sin(i * 1.7) * 90);
    const kcal = 1810 + noise + (weekend ? 240 : 0);
    const protein = 112 + Math.round(Math.sin(i * 0.6) * 16);
    const slots = [
      ['breakfast', ['燕麦牛奶', '全麦面包+鸡蛋', '豆浆+包子']],
      ['lunch', ['米饭+鸡胸肉+青菜', '牛肉面', '荞麦面+卤蛋']],
      ['dinner', ['杂粮饭+牛肉+西兰花', '米饭+清蒸鱼+菠菜', '意面+虾仁沙拉']],
    ];
    slots.forEach(([slot, names], idx) => {
      const r = ratio3[idx];
      const g = 210 + idx * 30;
      const values = {
        kcal: kcal * r, protein: protein * r,
        fat: (kcal * 0.29 * r) / 9, carbs: (kcal * 0.46 * r) / 4,
        fiber: 20 * r, sugar: 7 * r,
        sodium: ((weekend ? 2700 : 1750) * r),
        potassium: 3200 * r * 0.85, calcium: 780 * r * 0.62, iron: 13 * r,
        zinc: 12 * r, selenium: 60 * r, magnesium: 330 * r,
        va: 800 * r, vc: 100 * r * 0.42, vd: 9 * r, ve: 14 * r,
        b1: 1.3 * r, b2: 1.4 * r, niacin: 15 * r,
      };
      const { n, per100g } = item(names[i % names.length], g, values);
      meals.push({
        id: `p_${date}_${idx}`, date,
        eatenAt: d.getTime() + (8 + idx * 5) * 3600_000, slot,
        source: idx === 0 ? 'manual' : 'photo', photoId: null,
        items: [{
          id: `p_${date}_${idx}_0`, name: names[i % names.length], rawName: null, parentDish: null,
          foodId: null, matchType: 'library', matchScore: 0.9, grams: g, baseG: g,
          portionTier: 'medium', tierConfirmed: false, quantity: null, unit: null,
          gramSource: 'library', per100g, nutrition: n, fieldSource: {},
          components: null, confidence: 0.88, locked: false,
        }],
        totals: n, coverage: facts(Object.fromEntries(KEYS.map((k) => [k, 1]))),
        goalId: null, aiMeta: null, createdAt: d.getTime(), deletedAt: null,
      });
    });

    if (i % 3 === 0) {
      weights.push({
        id: `p_w_${date}`, date,
        weightKg: Number((78.4 - (29 - i) * 0.012 + Math.sin(i) * 0.25).toFixed(1)),
        bodyFatPct: null, waistCm: null, note: null, createdAt: d.getTime(),
      });
    }
  }

  const existing = await new Promise((res, rej) => {
    const tx = db.transaction(['weights'], 'readonly');
    const q = tx.objectStore('weights').getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(new Error('读取称重失败'));
  });
  const byDate = new Map(existing.map((w) => [w.date, w]));
  // 今天这条也要给个值，否则「今天 / 30 天前」对比会缺一头
  const t = new Date(today);
  const tKey = dayKeyOf(t);
  const todayW = byDate.get(tKey);
  if (todayW) weights.push({ ...todayW, weightKg: 78.0, createdAt: t.getTime() });
  const rows = weights.map((w) => {
    const old = byDate.get(w.date);
    return old ? { ...old, weightKg: w.weightKg, createdAt: w.createdAt } : w;
  });

  await new Promise((res, rej) => {
    const tx = db.transaction(['meals', 'weights'], 'readwrite');
    tx.oncomplete = () => res();
    tx.onerror = (e) => rej(new Error(`事务失败: ${e.target?.error?.message ?? '未知'}`));
    tx.onabort = () => rej(new Error('事务被中止'));
    for (const m of meals) tx.objectStore('meals').put(m);
    for (const w of rows) tx.objectStore('weights').put(w);
  });
  db.close();
  return { meals: meals.length, weights: rows.length };
});
console.log(`已写入 ${seeded.meals} 条餐次、${seeded.weights} 次称重`);

async function shot(name, { hash = '#/', wait = '.ringwrap', scroll = 0, delay = 500 } = {}) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle2', timeout: 30000 });
  // 注入数据后必须整页重载：goto 到相同 hash 不会重载文档，页面还停在注入前读到的空 state
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector(wait, { timeout: 20000 }).catch(() => console.log(`[warn] 未等到 ${wait}`));
  await sleep(delay);
  if (scroll > 0) {
    await page.evaluate((y) => {
      const m = document.querySelector('.main');
      if (m) m.scrollTop = y; else window.scrollTo(0, y);
    }, scroll);
    await sleep(450);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('OK', name);
}

// 今日页：顶部圆环 / 中段宏量+钠 / 微量营养素
await shot('today-top', { delay: 700 });
await shot('today-mid', { scroll: 420 });
await shot('today-micro', { scroll: 900 });

// 统计 / 周报
await shot('stats-week', { hash: '#/stats', wait: '.chart-bars', delay: 900 });
await shot('stats-detail', { hash: '#/stats', wait: '.chart-bars', scroll: 780, delay: 900 });

// 档案（目标设定）：0.5 kg/周 会触发「热量低于安全下限已上调」的黄色警告，
// 换 0.25 kg/周 就落在合理区间，宣传图上不必带一条负面提示
await shot('profile', { hash: '#/profile', wait: '.big', delay: 700 });
await page.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '0.25'));
  if (s) {
    s.value = '0.25';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await sleep(600);
await page.screenshot({ path: `${OUT}/profile-quiet.png` });
console.log('OK profile-quiet');

const numbers = await page.evaluate(() => ({
  kcal: document.querySelector('.big b')?.textContent ?? null,
}));
console.log('档案页首屏数字:', JSON.stringify(numbers));
if (errs.length) console.log('控制台错误:', errs.slice(0, 5));
await browser.close();
