/**
 * 真实照片 × 微矿补全率验证。
 *
 * 补完食物库不等于微矿就能显示 —— 还要看 AI 报的菜名能不能匹配上库。
 * 这个脚本对 app/testphotos 下每张实拍图跑一次真实识别，统计：
 *   - 每张图识别出几条食材
 *   - 其中几条匹配上了食物库（拿到 13 项微矿）、几条没有
 *   - 没匹配上的是哪些名字（用来决定还要往库里补什么）
 *
 * 不保存到库，只看识别结果，所以不会污染今日页数据。
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { loadEnv } from './env.mjs';

const BASE = 'http://localhost:4173';
const PHOTO_DIR = resolve(import.meta.dirname, '../testphotos');
const key = loadEnv().DASHSCOPE_API_KEY;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const photos = readdirSync(PHOTO_DIR)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .filter((f) => !f.includes('手机')) // 只跑用户实拍的 6 张，跳过之前生成的合成图
  .sort();

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));

await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type="password"]');
await page.type('input[type="password"]', key, { delay: 0 });
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')?.click();
});
await wait(400);

const report = [];

for (const file of photos) {
  await page.goto(`${BASE}/#/capture`, { waitUntil: 'networkidle2' });
  await wait(400);
  const input = await page.$('input[type="file"]');
  await input.uploadFile(resolve(PHOTO_DIR, file));

  try {
    await page.waitForSelector('.totalbar', { timeout: 150000 });
  } catch {
    report.push({ file, error: '识别超时' });
    continue;
  }
  await wait(400);

  const rows = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.selitem')) {
      const name = el.querySelector('.top b')?.textContent?.trim() ?? '';
      const grams = el.querySelector('.stepper b')?.textContent?.trim() ?? '';
      // 「12 项维生素矿物质参考「猪肝」」这类说明存在 = 该条拿到了库里的微量
      const hintEl = [...el.querySelectorAll('.hint')].find((h) => h.textContent.includes('维生素矿物质参考'));
      const hint = hintEl?.textContent?.trim() ?? '';
      const filled = hint ? Number(hint.match(/(\d+)\s*项/)?.[1] ?? 0) : 0;
      const from = hint.match(/参考「(.+?)」/)?.[1] ?? null;
      out.push({ name, grams, filled, from });
    }
    return out;
  });

  const matched = rows.filter((r) => r.from).length;
  report.push({
    file,
    items: rows.length,
    matched,
    unmatched: rows.filter((r) => !r.from).map((r) => r.name),
    detail: rows,
  });
  console.log(`${file} → ${rows.length} 项，命中库 ${matched} 项`);
}

console.log('\n===== 汇总 =====');
let total = 0;
let hit = 0;
for (const r of report) {
  if (r.error) { console.log(`${r.file}  ${r.error}`); continue; }
  total += r.items;
  hit += r.matched;
  const pct = r.items ? Math.round((r.matched / r.items) * 100) : 0;
  console.log(`${r.file}\n  ${r.items} 项，命中 ${r.matched} 项（${pct}%）  未命中：${r.unmatched.join('、') || '无'}`);
}
console.log(`\n整体命中率 ${hit}/${total} = ${Math.round((hit / total) * 100)}%`);
if (errors.length) console.log('页面错误：', errors.slice(0, 3));

await browser.close();
