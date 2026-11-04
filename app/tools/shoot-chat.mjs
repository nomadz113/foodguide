/**
 * 小助手（P3）全链路截图验证。
 *
 * 走真实浏览器 + 真实 API：填 Key → 说一句话定义食物 → 确认卡 → 保存 → 再说一句记账 → 确认 → 落库。
 * 只在有 API Key 时才值得跑，但脚本本身不做判断，跑失败会直接报错。
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));

async function say(text) {
  await page.click('.composer textarea');
  await page.type('.composer textarea', text, { delay: 0 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.composer .send')][0];
    b?.click();
  });
}

async function waitCard(timeout = 60000) {
  // 只等"还没确认"的那张卡：已完成/已取消的卡渲染成 .intentcard.done，没有按钮
  await page.waitForFunction(
    () => [...document.querySelectorAll('.intentcard')].some((c) => c.querySelector('.btn.primary')),
    { timeout },
  );
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.intentcard')].filter((c) => c.querySelector('.btn.primary'));
    const c = cards[cards.length - 1];
    return {
      title: c?.querySelector('.ic-title')?.textContent?.trim(),
      sub: c?.querySelector('.ic-sub')?.textContent?.trim(),
      cells: [...(c?.querySelectorAll('.ic-cell') ?? [])].map(
        (e) => `${e.querySelector('span')?.textContent}=${e.querySelector('b')?.textContent}`,
      ),
      items: [...(c?.querySelectorAll('.ic-item') ?? [])].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      notes: [...(c?.querySelectorAll('.ic-notes div') ?? [])].map((e) => e.textContent.trim()),
      buttons: [...(c?.querySelectorAll('.ic-btns .btn') ?? [])].map((e) => e.textContent.trim()),
    };
  });
}

async function clickPrimary() {
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.intentcard')].filter((c) => c.querySelector('.btn.primary'));
    const c = cards[cards.length - 1];
    [...(c?.querySelectorAll('.ic-btns .btn') ?? [])]
      .find((x) => /保存|记入|确认/.test(x.textContent || ''))?.click();
  });
}

// 1) 填 Key
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type="password"]');
await page.type('input[type="password"]', key, { delay: 0 });
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click();
});
await wait(600);
console.log('Key 已写入');

// 2) 聊天页初始态
await page.goto(`${BASE}/#/chat`, { waitUntil: 'networkidle2' });
await wait(700);
await page.screenshot({ path: `${OUT}/30-chat-empty.png` });
console.log('空态截图完成');

// 3) 定义食物
const t0 = Date.now();
await say('记住，我妈做的红烧肉，一碗大概 320 大卡，蛋白质 18g、脂肪 22g、碳水 15g');
const food = await waitCard();
console.log(`\n定义食物（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log('  标题:', food.title);
console.log('  副标题:', food.sub);
console.log('  数字:', food.cells.join(' | '));
console.log('  提示:', food.notes.join(' / '));
console.log('  按钮:', food.buttons.join(' / '));
await page.screenshot({ path: `${OUT}/31-chat-food-card.png` });

// 4) 编辑态看一眼
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.intentcard')].filter((c) => c.querySelector('.btn.primary'));
  [...(cards[cards.length - 1]?.querySelectorAll('.ic-btns .btn') ?? [])]
    .find((b) => b.textContent.includes('修改'))?.click();
});
await wait(400);
await page.screenshot({ path: `${OUT}/32-chat-food-edit.png` });
const editFields = await page.evaluate(() =>
  [...document.querySelectorAll('.numfield')].map((e) => ({
    label: e.querySelector('span')?.textContent,
    value: e.querySelector('input')?.value,
  })));
console.log('  编辑字段:', editFields.map((f) => `${f.label}=${f.value}`).join(' '));

// 改回非编辑态再保存
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.intentcard')].filter((c) => c.querySelector('.btn.primary'));
  [...(cards[cards.length - 1]?.querySelectorAll('.ic-btns .btn') ?? [])]
    .find((b) => b.textContent.includes('改回'))?.click();
});
await wait(300);
await clickPrimary();
await wait(900);
const afterSave = await page.evaluate(() =>
  [...document.querySelectorAll('.msg .bub')].map((b) => b.textContent.trim()).slice(-1)[0]);
console.log('  保存回执:', afterSave);
await page.screenshot({ path: `${OUT}/33-chat-food-saved.png` });

// 5) 一句话记账
const t1 = Date.now();
await say('今天中午吃了番茄炒蛋和一碗米饭');
const meal = await waitCard();
console.log(`\n记一餐（${((Date.now() - t1) / 1000).toFixed(1)}s）`);
console.log('  标题:', meal.title);
console.log('  条目:', meal.items.join(' | '));
console.log('  提示:', meal.notes.join(' / '));
await page.screenshot({ path: `${OUT}/34-chat-meal-card.png` });

await clickPrimary();
await wait(1200);
const mealReceipt = await page.evaluate(() =>
  [...document.querySelectorAll('.msg .bub')].map((b) => b.textContent.trim()).slice(-1)[0]);
console.log('  记账回执:', mealReceipt);
await page.screenshot({ path: `${OUT}/35-chat-meal-saved.png` });

// 6) 回今日页确认真的落库了
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
await wait(900);
const today = await page.evaluate(() => ({
  kcal: document.querySelector('.ring-center b')?.textContent ?? document.querySelector('.big b')?.textContent,
  meals: [...document.querySelectorAll('.meal')].map((m) => m.textContent.replace(/\s+/g, ' ').trim()),
}));
console.log('\n今日页:', today.kcal, 'kcal');
console.log('  餐次:', today.meals.join(' | ') || '(无)');
await page.screenshot({ path: `${OUT}/36-today-after-chat.png` });

console.log('\n控制台错误:', errors.length ? errors.slice(0, 5) : '无');
await browser.close();
