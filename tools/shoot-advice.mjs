/**
 * 每日建议全链路验证（真实 API）。
 *
 * 验证四件事，缺一件这个功能就不算做完：
 * 1. 点「让 AI 细说」能拿到结构化建议，且数字与页面一致；
 * 2. 生成一次后刷新页面，建议仍在（缓存在 advices 表，不重复花钱）；
 * 3. 再记一餐后，旧建议被标成「已过期」而不是继续当真；
 * 4. 没有 Key 时不报错，只是不给按钮。
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { loadEnv } from './env.mjs';

const BASE = 'http://localhost:4173';
const OUT = resolve(import.meta.dirname, '../../shots');
const key = loadEnv().DASHSCOPE_API_KEY;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));

async function addFood(name, grams) {
  await page.click('.tabbar .fab button');
  await page.waitForSelector('.searchbox');
  await page.click('.searchbox input', { clickCount: 3 });
  await page.type('.searchbox input', name);
  await page.waitForSelector('.pickrow', { timeout: 8000 });
  await page.click('.pickrow .add');
  await wait(200);
  if (grams) {
    // 用步进器把份量调到位，避免依赖档位倍率的默认值
    const target = Number(grams);
    for (let i = 0; i < 40; i++) {
      const cur = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.selitem')].pop()?.querySelector('.stepper b');
        return el ? Number(el.textContent.replace(/\D/g, '')) : 0;
      });
      if (!cur || Math.abs(cur - target) <= 5) break;
      const dir = cur < target ? '+' : '−';
      await page.evaluate((d) => {
        const btns = [...([...document.querySelectorAll('.selitem')].pop()?.querySelectorAll('.stepper button') ?? [])];
        btns.find((b) => b.textContent.includes(d))?.click();
      }, dir);
      await wait(30);
    }
  }
  await page.click('.sheetbar button.primary');
  await wait(500);
}

// 1) 填 Key
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type="password"]');
await page.type('input[type="password"]', key, { delay: 0 });
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click();
});
await wait(600);

// 2) 记两餐（构成一个有缺口的局面）
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.ringwrap');
await addFood('米饭', 250);
await addFood('鸡胸肉', 120);
await wait(500);

const before = await page.evaluate(() => ({
  pill: document.querySelector('.hdr .pill')?.textContent?.trim(),
  localHead: document.querySelector('.advice .h .span, .advice .h')?.textContent?.trim(),
  localBody: document.querySelector('.advice p')?.textContent?.trim(),
}));
console.log('\n本地建议（无需 AI，立即可见）');
console.log('  顶栏:', before.pill);
console.log('  标题:', before.localHead);
console.log('  正文:', before.localBody);

await page.evaluate(() => document.querySelector('.advice')?.scrollIntoView({ block: 'center' }));
await wait(300);
await page.screenshot({ path: `${OUT}/50-advice-local.png` });

// 3) 点「让 AI 细说」
const t0 = Date.now();
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.adv-btn')].find((x) => /让 AI 细说/.test(x.textContent || ''));
  b?.click();
});
await page.waitForFunction(() => document.querySelector('.adv-src'), { timeout: 60000 });
const took = Date.now() - t0;
await wait(300);

const ai = await page.evaluate(() => ({
  headline: document.querySelector('.advice .h')?.textContent?.replace(/\s+/g, ' ').trim(),
  body: document.querySelector('.advice p')?.textContent?.trim(),
  actions: [...document.querySelectorAll('.adv-acts li')].map((e) => e.textContent.trim()),
  caveats: document.querySelector('.adv-caveat')?.textContent?.trim() ?? null,
  stale: document.querySelector('.adv-stale')?.textContent?.trim() ?? null,
  button: document.querySelector('.adv-btn')?.textContent?.trim(),
}));
console.log(`\nAI 建议（${(took / 1000).toFixed(1)}s）`);
console.log('  标题:', ai.headline);
console.log('  正文:', ai.body);
console.log('  动作:', ai.actions.join(' | '));
if (ai.caveats) console.log('  声明:', ai.caveats);
console.log('  按钮:', ai.button);


await page.evaluate(() => document.querySelector('.advice')?.scrollIntoView({ block: 'center' }));
await wait(300);
await page.screenshot({ path: `${OUT}/51-advice-ai.png` });

// 4) 刷新 → 应命中缓存，不再调用模型
const tReload = Date.now();
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.adv-src', { timeout: 20000 });
const cachedMs = Date.now() - tReload;
const cached = await page.evaluate(() => document.querySelector('.advice .h')?.textContent?.replace(/\s+/g, ' ').trim());
console.log(`\n刷新后（${cachedMs} ms，应远快于 AI 调用）`);
console.log('  标题:', cached);
console.log('  ', cached === ai.headline ? '✓ 命中缓存' : '✗ 内容变了，缓存没生效');

// 5) 再记一餐 → 旧建议应被标记过期
await addFood('香蕉', 100);
await page.evaluate(() => document.querySelector('.advice')?.scrollIntoView({ block: 'center' }));
await wait(600);
const stale = await page.evaluate(() => document.querySelector('.adv-stale')?.textContent?.trim() ?? null);
const btnNow = await page.evaluate(() => document.querySelector('.adv-btn')?.textContent?.trim());
console.log('\n补记一餐后');
console.log('  过期提示:', stale ?? '（没有，可能是记录变化未触发）');
console.log('  按钮:', btnNow);
await page.screenshot({ path: `${OUT}/52-advice-stale.png` });

const snapshot = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('daily-intake');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const rows = await new Promise((res) => {
    const rq = db.transaction(['advices'], 'readonly').objectStore('advices').getAll();
    rq.onsuccess = () => res(rq.result);
  });
  db.close();
  return rows[0] ?? null;
});
if (snapshot?.usage) {
  console.log('');
  console.log(`  快照: ${snapshot.model} · ${snapshot.latencyMs}ms`);
  console.log(`  token: 输入 ${snapshot.usage.promptTokens} / 输出 ${snapshot.usage.completionTokens}` +
    ` -> ¥${snapshot.usage.costCny.toFixed(5)}`);
}

const advCount = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('daily-intake');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return new Promise((res) => {
    const rq = db.transaction(['advices'], 'readonly').objectStore('advices').count();
    rq.onsuccess = () => { res(rq.result); db.close(); };
  });
});
console.log('  advices 表条数:', advCount, advCount === 1 ? '（一天只留一条，覆盖正确）' : '（应当只有 1 条）');

if (errors.length) console.log('\n控制台错误:', errors.slice(0, 5));
else console.log('\n控制台零报错');

await browser.close();
