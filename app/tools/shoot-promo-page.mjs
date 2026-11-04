/**
 * 把 promo/index.html 导出成 PNG（产品介绍长图 + 3 张竖版功能卡）。
 *
 * 前置：node tools/serve-static.mjs 4300（图片在项目根，必须走 http 取图）
 * 用法：node tools/shoot-promo-page.mjs [baseUrl]
 */
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASE = argv[0] ?? 'http://127.0.0.1:4300';
const OUT = resolve(import.meta.dirname, '../../promo');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run', '--force-device-scale-factor=1.5'],
  defaultViewport: { width: 1080, height: 1400, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
page.on('requestfailed', (r) => errs.push(`FAILED ${r.url()}`));

await page.goto(`${BASE}/promo/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });

// 所有截图必须先解码完成，否则长图里会出现空白帧
await page.evaluate(async () => {
  await Promise.all(
    [...document.images].map((img) => (img.complete ? null : new Promise((r) => {
      img.onload = r;
      img.onerror = r;
    }))),
  );
});
const sizes = await page.evaluate(() =>
  [...document.images].map((i) => `${i.naturalWidth}x${i.naturalHeight}`));
console.log('图片实际尺寸:', sizes.join(' '));

// ── 长图：隐藏竖版卡，只截 .page ──
await page.addStyleTag({ content: '.cards{display:none!important}' });
const pageEl = await page.$('.page');
await pageEl.screenshot({ path: join(OUT, '每日摄入-产品介绍.png') });
const pageBox = await pageEl.boundingBox();
console.log(`OK 长图 ${Math.round(pageBox.width)}x${Math.round(pageBox.height)}`);

// 局部检查图：整张长图缩放后看不清排版细节，分段导出更靠谱
if (process.argv.includes('--check')) {
  const checkDir = join(OUT, '_check');
  mkdirSync(checkDir, { recursive: true });
  await page.evaluate(() => {
    document.querySelector('.hero')?.setAttribute('data-chk', 'hero');
    document.querySelectorAll('.sec').forEach((s, i) => s.setAttribute('data-chk', `sec${i + 1}`));
  });
  for (const name of ['hero', 'sec1', 'sec2', 'sec3', 'sec4', 'sec5']) {
    const el = await page.$(`[data-chk="${name}"]`);
    if (!el) continue;
    await el.screenshot({ path: join(checkDir, `${name}.png`) });
  }
  console.log('OK 局部检查图 → promo/_check/');
}

// ── 竖版卡：反过来只留 .cards ──
await page.addStyleTag({
  content: '.page{display:none!important}.cards{position:static!important;left:auto!important;top:auto!important;display:block!important}',
});
for (const [i, id] of ['card1', 'card2', 'card3'].entries()) {
  const el = await page.$(`#${id}`);
  await el.screenshot({ path: join(OUT, `功能卡-${i + 1}.png`) });
  console.log(`OK 功能卡-${i + 1}`);
}

if (errs.length) console.log('错误:', errs.slice(0, 5));
else console.log('无页面错误');
await browser.close();
