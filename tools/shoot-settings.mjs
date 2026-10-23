/**
 * 设置页截图：备份区块是新加的，肉眼确认一下排版没塌。
 * 用法：先起 vite preview --port 4173，再 node tools/shoot-settings.mjs
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const BASE = 'http://localhost:4173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve(process.cwd(), 'tools/.shots');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE}/#/profile`, { waitUntil: 'networkidle2' });
await wait(1200);
await page.evaluate(() => {
  [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('设置'))?.click();
});
await wait(900);

await page.screenshot({ path: resolve(OUT, 'settings-backup.png'), fullPage: true });

// 第二张：导入预览卡片（拿最近一次导出的文件喂进去）
const dl = resolve(process.cwd(), 'tools/.downloads');
const files = readdirSync(dl).filter((f) => f.endsWith('.json'));
if (files.length) {
  const [chooser] = await Promise.all([
    page.waitForFileChooser(),
    page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '导入备份')?.click();
    }),
  ]);
  await chooser.accept([resolve(dl, files[0])]);
  await wait(900);
  await page.screenshot({ path: resolve(OUT, 'settings-import-preview.png'), fullPage: true });
  console.log('预览卡片文字：', await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('备份内容'));
    return card?.innerText.replace(/\n+/g, ' | ') ?? '未找到';
  }));
}

console.log('已截图到', OUT);
await browser.close();
