/**
 * 给用户看的两张图：
 *   1) APK 首次启动（超过 8 小时）会看到什么
 *   2) 点掉之后的应用长什么样
 */
import puppeteer from 'puppeteer-core';

const URL_ARG = process.argv[2] || 'https://nomadz-d7gjjkkjleb118f55-1513689063.tcloudbaseapp.com/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const UA =
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
await page.setUserAgent(UA);

await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(3000);

const isNotice = await page.evaluate(() => (document.body.innerText || '').includes('页面访问提示'));
if (isNotice) {
  await page.screenshot({ path: 'apk-first-open.png' });
  console.log('已截图：首次启动的提示页');
}

for (let i = 0; i < 10; i++) {
  const s = await page.evaluate(() => {
    const b = document.querySelector('.redirect-page__operate-submit');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { disabled: b.disabled, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (s && !s.disabled) { await page.mouse.click(s.x, s.y); break; }
  await sleep(1000);
}
await sleep(6000);

const ok = await page.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent ?? '',
  tabs: [...document.querySelectorAll('.tabbar a')].map((a) => a.textContent.trim()),
}));
await page.screenshot({ path: 'apk-after-gate.png' });
console.log('点完之后:', JSON.stringify(ok));

await browser.close();
