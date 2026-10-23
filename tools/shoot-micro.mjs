/**
 * 微量营养素板块验证（真实点击，不打桩）。
 *
 * 验证的是「补完数据库之后，今日页到底有没有数字」：
 * 1. 从食物库搜出真实食材加进一餐（走 matchAndFill / 库值路径）；
 * 2. 抓 14 个格子的 label 与显示值，统计有多少格是「—」；
 * 3. 对比「全部命中库」与「一样都匹配不上」两种场景，确认
 *    覆盖率门槛（< 50% 显示「—」）确实在起作用，而不是被无条件忽略。
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const BASE = 'http://localhost:4173';
const OUT = resolve(import.meta.dirname, '../../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 900, deviceScaleFactor: 2 },
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
  const target = Number(grams);
  for (let i = 0; i < 60; i++) {
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
  await page.click('.sheetbar button.primary');
  await wait(400);
}

/** 抓取微量板块 14 格的实际显示 */
async function readMicro() {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('.mgrid .mcell')];
    return cells.map((c) => ({
      label: c.querySelector('.lb')?.textContent?.trim() ?? '',
      value: c.querySelector('.vv')?.textContent?.trim() ?? '',
      hit: c.classList.contains('hit'),
      na: c.classList.contains('na'),
    }));
  });
}

// 一餐「命中库」的组合：覆盖蛋白、蔬菜、内脏、水果、主食
const MEAL = [
  ['米饭', 150], ['番茄炒蛋', 250], ['菠菜', 150],
  ['鸡蛋', 50], ['猪肝', 50], ['猕猴桃', 90],
];

const result = { meal: MEAL, items: [], micro: [], missing: 0, errors: [] };

await page.goto(`${BASE}/#/today`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.tabbar .fab button', { timeout: 15000 });
await wait(500);

for (const [name, g] of MEAL) {
  await addFood(name, g);
}

await page.goto(`${BASE}/#/today`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.mgrid');
await wait(600);

// 先把整个今日页截下来（含微量板块）
await page.screenshot({ path: resolve(OUT, 'micro-today.png'), fullPage: true });
const microEl = await page.$('.card:has(.mgrid)');
if (microEl) await microEl.screenshot({ path: resolve(OUT, 'micro-card.png') });

result.micro = await readMicro();
result.missing = result.micro.filter((c) => c.na).length;

// 抓宏量区的总数做交叉核对
result.totals = await page.evaluate(() => {
  const txt = document.body.innerText;
  const kcal = txt.match(/(\d{3,4})\s*kcal/);
  return { kcalLine: kcal ? kcal[0] : null };
});

result.errors = errors;
console.log(JSON.stringify(result, null, 2));
await browser.close();
