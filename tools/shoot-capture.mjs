/**
 * 拍照识别全链路截图验证。
 * 走真实浏览器 + 真实 API，验证：填 Key → 测试连接 → 选图 → 流式识别 → 三档联动 → 保存。
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { loadEnv } from './env.mjs';

const BASE = 'http://localhost:4173';
const OUT = resolve(import.meta.dirname, '../../shots');
const PHOTO = process.env.SHOT_PHOTO
  ? resolve(process.env.SHOT_PHOTO)
  : resolve(
      import.meta.dirname,
      '../testphotos/微信图片_20261022192036_10_270.jpg',
    );

const key = loadEnv().DASHSCOPE_API_KEY;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-web-security=false'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));

// 1) 设置页填 Key
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type="password"]');
await page.type('input[type="password"]', key, { delay: 0 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存');
  btn?.click();
});
await wait(500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('测试连接'));
  btn?.click();
});
await wait(3500);
const pingMsg = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.hint')].find((e) => e.textContent.includes('连接') || e.textContent.includes('失败'));
  return el?.textContent?.trim() ?? '(无提示)';
});
console.log('测试连接 →', pingMsg);
await page.screenshot({ path: `${OUT}/10-settings-key.png` });

// 2) 拍照页初始态
await page.goto(`${BASE}/#/capture`, { waitUntil: 'networkidle2' });
await wait(600);
await page.screenshot({ path: `${OUT}/11-capture-idle.png` });

// 3) 塞图片，触发识别
const input = await page.$('input[type="file"]');
await input.uploadFile(PHOTO);
const t0 = Date.now();

// 流式中途截一张（首项大约 5 秒到达）
await wait(9000);
const streaming = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.card .krow')].length,
  status: document.querySelector('.card .row b')?.textContent ?? '',
}));
console.log(`识别中（${Date.now() - t0}ms）→ 已到 ${streaming.rows} 项，状态「${streaming.status}」`);
await page.screenshot({ path: `${OUT}/12-capture-streaming.png` });

// 4) 等 done
await page.waitForSelector('.totalbar', { timeout: 120000 });
const took = Date.now() - t0;
const summary = await page.evaluate(() => ({
  kcal: document.querySelector('.totalbar .big b')?.textContent ?? '?',
  macros: [...document.querySelectorAll('.totalbar .macro3 b')].map((b) => b.textContent),
  items: [...document.querySelectorAll('.selitem .top b')].map((b) => b.textContent.trim()),
  grams: [...document.querySelectorAll('.selitem .stepper b')].map((b) => b.textContent),
  assumptions: [...document.querySelectorAll('.card .hint')].map((e) => e.textContent.trim()).filter((t) => t.startsWith('·')),
  micro: [...document.querySelectorAll('.selitem .hint')].map((e) => e.textContent.trim()),
}));
console.log(`识别完成 ${(took / 1000).toFixed(1)}s`);
console.log('合计', summary.kcal, 'kcal | 宏量', summary.macros.join(' / '));
console.log('条目:', summary.items.map((t, i) => `${t}=${summary.grams[i]}`).join('  '));
console.log('微量补全:', summary.micro.length ? summary.micro.join(' | ') : '(无)');
console.log('假设:', summary.assumptions.join(' | '));
await page.screenshot({ path: `${OUT}/13-capture-done.png` });

// 5) 点大份，验证整餐联动
const before = await page.evaluate(() => document.querySelector('.totalbar .big b')?.textContent);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.tiers3 button')].find((b) => b.textContent.includes('大份'));
  btn?.click();
});
await wait(400);
const after = await page.evaluate(() => ({
  kcal: document.querySelector('.totalbar .big b')?.textContent,
  grams: [...document.querySelectorAll('.selitem .stepper b')].map((b) => b.textContent),
}));
console.log(`大份联动: ${before} → ${after.kcal} kcal | ${after.grams.join(' ')}`);
await page.screenshot({ path: `${OUT}/14-capture-large.png` });

// 6) 保存并回今日页
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.sheetbar button')].find((b) => b.textContent.includes('保存'));
  btn?.click();
});
await wait(1200);
const landed = await page.evaluate(() => location.hash);
console.log('保存后路由:', landed);
await page.screenshot({ path: `${OUT}/15-today-after-save.png` });

console.log('\n控制台错误:', errors.length ? errors.slice(0, 5) : '无');
await browser.close();
