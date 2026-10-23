/**
 * 线上站点验收：真浏览器打开部署后的链接，确认三件事。
 *
 *   node tools/check-live.mjs "https://xxx/?sharecode=..."
 *
 * 1. 首屏真的渲染出来（不是白屏、不是 403 页面）
 * 2. Service Worker 注册并接管（否则装到桌面也没有离线能力）
 * 3. 断网后 reload 仍能起来（NetworkFirst 的兜底确实生效）
 */
import puppeteer from 'puppeteer-core';

const url = process.argv[2];
if (!url) {
  console.error('用法: node tools/check-live.mjs <url>');
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
page.on('requestfailed', (r) => errors.push(`FAILED ${r.url().slice(0, 120)}`));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
// 等 React 挂载：直接 evaluate 会在首帧前撞上「execution context destroyed」
await page.waitForSelector('.app', { timeout: 20000 }).catch(() => {});

const boot = await page.evaluate(async () => {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
  return {
    title: document.title,
    appMounted: document.querySelectorAll('.app').length > 0,
    tabbar: document.querySelectorAll('.tabbar a').length,
    heading: document.querySelector('h1')?.textContent ?? '',
    swScope: reg?.scope ?? null,
    swController: Boolean(navigator.serviceWorker?.controller),
    manifest: document.querySelector('link[rel=manifest]')?.href ?? null,
    startUrl: null,
  };
});

const manifest = await page.evaluate(async (href) => {
  if (!href) return null;
  const r = await fetch(href);
  const m = await r.json();
  return { name: m.name, display: m.display, start_url: m.start_url, icons: m.icons?.length ?? 0 };
}, boot.manifest);

// 断网 → 重载
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
const offline = await page
  .evaluate(() => ({ appMounted: document.querySelectorAll('.app').length > 0, heading: document.querySelector('h1')?.textContent ?? '' }))
  .catch(() => ({ appMounted: false, heading: '' }));

await page.screenshot({ path: 'live-home.png' });

await browser.close();

console.log(JSON.stringify({ boot, manifest, offline, errors: errors.slice(0, 5) }, null, 2));
const ok = boot.appMounted && boot.swController && offline.appMounted;
console.log(`\n结果: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
