/**
 * 探测「APK 里 WebView 加载腾讯云默认域名」会看到什么。
 *
 * 关键怀疑点：tcloudbaseapp.com 的访问提示中间页可能对 WebView 的 UA（带 `wv`）走另一套逻辑，
 * 例如直接拒绝、或者不放行「确定访问」。必须用真实 WebView UA 测，不能用桌面 UA 推断。
 */
import puppeteer from 'puppeteer-core';

const URL_ARG = process.argv[2] || 'https://nomadz-d7gjjkkjleb118f55-1513689063.tcloudbaseapp.com/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// Android 12 + Chrome 114 的 WebView UA（国产 ROM 上常见的老内核量级）
const WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 12; V2049A Build/SP1A.210812.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  defaultViewport: { width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  protocolTimeout: 120000,
});

const page = await browser.newPage();
await page.setUserAgent(WEBVIEW_UA);

const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 140)));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('console: ' + m.text().slice(0, 140));
});

await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(2500);

const first = await page.evaluate(() => ({
  title: document.title,
  hasNotice: (document.body.innerText || '').includes('页面访问提示'),
  bodyHead: (document.body.innerText || '').trim().slice(0, 120).replace(/\s+/g, ' '),
  app: document.querySelectorAll('.app').length,
  cookies: document.cookie,
}));

// 找按钮：文案带倒计时，且 disabled，需要等到可点
let btn = null;
for (let i = 0; i < 10; i++) {
  const s = await page.evaluate(() => {
    const b = document.querySelector('.redirect-page__operate-submit');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), disabled: b.disabled, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (s && !s.disabled) { btn = s; break; }
  await sleep(1200);
}

let after = null;
if (btn) {
  await page.mouse.click(btn.x, btn.y);
  await sleep(6000);
  after = await page.evaluate(() => ({
    title: document.title,
    hasNotice: (document.body.innerText || '').includes('页面访问提示'),
    app: document.querySelectorAll('.app').length,
    h1: document.querySelector('h1')?.textContent ?? '',
    cookies: document.cookie,
    sw: Boolean(navigator.serviceWorker?.controller),
  }));
}

await page.screenshot({ path: 'live-webview.png', timeout: 20000 }).catch(() => {});
await browser.close();

console.log(JSON.stringify({ ua: 'WebView (wv)', first, buttonFound: Boolean(btn), btn, after, logs: logs.slice(0, 8) }, null, 2));
