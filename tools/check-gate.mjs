/**
 * CloudBase 默认域名的可用性判定。
 *
 * 默认域名（*.tcloudbaseapp.com）对浏览器导航请求会插「页面访问提示」中间页。
 * 这个脚本要回答三个问题：
 *   1. 点「确定访问」之后，应用能不能正常渲染、SW 能不能接管
 *   2. 同一个浏览器再打开（新标签）还会不会弹中间页 —— 决定装到桌面后是不是每次都要点
 *   3. 断网后 reload 还能不能起来
 *
 * 中间页按钮带倒计时且 disabled，必须等它变可用再点（用坐标点，不用 click 选择器）。
 */
import puppeteer from 'puppeteer-core';

const url = process.argv[2];
if (!url) {
  console.error('用法: node tools/check-gate.mjs <url>');
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  protocolTimeout: 90000,
});

// 注意：page.evaluate 里只能跑浏览器上下文代码，这些 helper 必须在页面里重新定义
const appState = () => ({
  app: document.querySelectorAll('.app').length,
  h1: document.querySelector('h1')?.textContent ?? '',
  notice: (document.body.innerText || '').includes('页面访问提示'),
  sw: Boolean(navigator.serviceWorker?.controller),
});

async function passGate(page) {
  await page.waitForSelector('.redirect-page__operate-submit', { timeout: 12000 }).catch(() => null);
  for (let i = 0; i < 10; i++) {
    const s = await page.evaluate(() => {
      const b = document.querySelector('.redirect-page__operate-submit');
      return b ? { disabled: b.disabled } : null;
    });
    if (!s) return 'no-notice';
    if (!s.disabled) {
      const box = await page.evaluate(() => {
        const b = document.querySelector('.redirect-page__operate-submit');
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(box.x, box.y);
      await new Promise((r) => setTimeout(r, 5000));
      return 'clicked';
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return 'button-never-enabled';
}

// ── 第一次访问 ──
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
const gate = await passGate(page);
const first = await page.evaluate(appState);
await page.screenshot({ path: 'live-cloudbase-after.png', timeout: 20000 }).catch(() => {});

// ── 第二次访问（新标签、同一浏览器 = 同一 cookie 域）──
const page2 = await browser.newPage();
await page2.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 4000));
const second = await page2.evaluate(appState);

// ── 断网重载 ──
await page2.setOfflineMode(true);
await page2.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const offline = await page2.evaluate(appState).catch(() => ({ app: 0, h1: '', notice: false, sw: false }));

await browser.close();

const ok = first.app > 0 && second.app > 0 && !second.notice && offline.app > 0;
console.log(JSON.stringify({ gate, first, second, offline }, null, 2));
console.log(`\n结果: ${ok ? 'PASS' : 'CHECK'}`);
