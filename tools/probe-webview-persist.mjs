/**
 * 验证「放行状态能否跨进程重启保留」——这决定 APK 每次启动是不是都要手点一次。
 *
 * 用持久化 userDataDir 模拟 WebView 的 CookieManager 落盘：
 *   pass1 首次访问 → 点掉中间页 → 记录状态
 *   关掉浏览器
 *   pass2 重开同一 profile → 看还弹不弹
 * 顺便记录 404 的具体 URL（线上有两条 404 一直没查清）。
 */
import puppeteer from 'puppeteer-core';
import { rmSync } from 'node:fs';

const URL_ARG = process.argv[2] || 'https://nomadz-d7gjjkkjleb118f55-1513689063.tcloudbaseapp.com/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = 'C:/Users/Admin/Desktop/每日摄入指南/app/.tmp-webview-profile';

const WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 12; V2049A Build/SP1A.210812.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    userDataDir: PROFILE,
    defaultViewport: { width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    protocolTimeout: 120000,
  });
  const page = await browser.newPage();
  await page.setUserAgent(WEBVIEW_UA);
  const notFound = [];
  page.on('response', (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`); });
  return { browser, page, notFound };
}

const state = (page) =>
  page.evaluate(() => ({
    title: document.title,
    notice: (document.body.innerText || '').includes('页面访问提示'),
    app: document.querySelectorAll('.app').length,
    h1: document.querySelector('h1')?.textContent ?? '',
    sw: Boolean(navigator.serviceWorker?.controller),
  }));

// ── pass 1：首次访问，点掉中间页 ──
let { browser, page, notFound } = await open();
await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(2500);
const p1Before = await state(page);

let clicked = false;
for (let i = 0; i < 10; i++) {
  const s = await page.evaluate(() => {
    const b = document.querySelector('.redirect-page__operate-submit');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { disabled: b.disabled, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (s && !s.disabled) { await page.mouse.click(s.x, s.y); clicked = true; break; }
  await sleep(1200);
}
await sleep(5000);
const p1After = await state(page);
await browser.close();
await sleep(1200);

// ── pass 2：同一 profile 重开，不点任何东西 ──
({ browser, page, notFound } = await open());
await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(4000);
const p2 = await state(page);
await page.screenshot({ path: 'live-webview-restart.png', timeout: 20000 }).catch(() => {});
await browser.close();

rmSync(PROFILE, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      pass1_first: p1Before,
      pass1_clicked: clicked,
      pass1_after: p1After,
      pass2_restart: p2,
      '结论': p2.notice ? '重启后仍弹中间页 → 每次启动都要手点' : '重启后不再弹 → 点一次即可',
      notFound: [...new Set(notFound)].slice(0, 8),
    },
    null,
    2
  )
);
