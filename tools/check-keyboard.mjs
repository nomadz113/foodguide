/**
 * 软键盘让位的端到端验证。
 *
 * 真机上没法脚本化地弹出输入法，但可以**复刻它的几何效果**：
 * Android WebView / iOS Safari 的默认行为是「布局视口不变、可视视口被压掉一截」，
 * 也就是 window.innerHeight 保持全屏、visualViewport.height 变小。
 * 这里注入一个可编程的假 visualViewport，正是这个情形。
 *
 * 要验的不是「有没有上移」，而是三个具体数字：
 *   1) .app 高度 = 全屏高 - 键盘高
 *   2) 输入条（textarea）完整落在键盘上沿之上 —— 这才是用户真正抱怨的那件事
 *   3) 键盘收起后完全还原（不能留一截空白）
 *
 * 用法：先起 vite preview --port 4173，再 node tools/check-keyboard.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:4173';
const KB = 320;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '.shots');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const checkNear = (name, got, want, tol = 2) => {
  const ok = Math.abs(got - want) <= tol;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want≈${want}`}`);
};
const checkTrue = (name, got) => check(name, !!got, true);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));

// 必须在页面脚本跑之前装好，否则 ui/keyboard.ts 启动时读到的是真的 visualViewport
await page.evaluateOnNewDocument(() => {
  const vv = {
    width: window.innerWidth,
    scale: 1,
    offsetTop: 0,
    pageTop: 0,
    pageLeft: 0,
    get height() {
      return window.__kbH ?? window.innerHeight;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
  window.__setKb = (px) => {
    window.__kbH = px > 0 ? window.innerHeight - px : window.innerHeight;
    window.dispatchEvent(new Event('resize'));
  };
});

await page.goto(`${BASE}/#/chat`, { waitUntil: 'networkidle2' });
await wait(1200);

const geom = () => page.evaluate(() => {
  const app = document.querySelector('.app');
  const ta = document.querySelector('.composer textarea');
  const tab = document.querySelector('.tabbar');
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  return {
    innerH: window.innerHeight,
    appH: app ? Math.round(r(app).height) : -1,
    taTop: ta ? Math.round(r(ta).top) : -1,
    taBottom: ta ? Math.round(r(ta).bottom) : -1,
    tabBottom: tab ? Math.round(r(tab).bottom) : -1,
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
    kbOpen: document.documentElement.classList.contains('kb-open'),
  };
});

// ── 1. 键盘没弹起：一切照旧 ──────────────────────────
const before = await geom();
checkTrue('聊天页有输入条', before.taBottom > 0);
check('未弹起时 --kb 为 0px', before.kb, '0px');
checkNear('未弹起时 app 高度 = 全屏高', before.appH, before.innerH, 2);

// ── 2. 聚焦输入框 + 弹起键盘 ─────────────────────────
await page.click('.composer textarea');
await page.evaluate((k) => window.__setKb(k), KB);
await wait(400);

const during = await geom();
const keyboardTop = during.innerH - KB;
check('弹起后 --kb = 键盘高度', during.kb, `${KB}px`);
checkTrue('弹起后 html 带 kb-open 标记', during.kbOpen);
checkNear('弹起后 app 高度 = 全屏 - 键盘', during.appH, keyboardTop, 2);
checkNear('底部导航整体上移到键盘上沿', during.tabBottom, keyboardTop, 3);
checkTrue('输入条完整在键盘上方（不被遮挡）', during.taBottom <= keyboardTop && during.taTop > 0);
checkTrue('输入框仍在可视区内', during.taTop >= 0 && during.taBottom <= during.innerH);

await page.screenshot({ path: resolve(OUT, 'chat-keyboard.png') });

// 内容区（消息列表）也要跟着收缩，不能溢出到键盘后面
const mainBottom = await page.evaluate(() => {
  const m = document.querySelector('.main');
  return m ? Math.round(m.getBoundingClientRect().bottom) : -1;
});
checkTrue('消息区底部没有伸到键盘后面', mainBottom <= keyboardTop + 2);

// ── 3. 收起键盘：完全还原 ────────────────────────────
await page.evaluate(() => window.__setKb(0));
await wait(400);
const after = await geom();
check('收起后 --kb 归零', after.kb, '0px');
checkNear('收起后 app 高度还原', after.appH, after.innerH, 2);
checkNear('收起后输入条回到原处', after.taBottom, before.taBottom, 2);

// ── 4. 换个页面也要生效（设置页有输入框）────────────
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' });
await wait(900);
await page.evaluate((k) => window.__setKb(k), KB);
await wait(400);
const st = await page.evaluate((kb) => {
  const app = document.querySelector('.app');
  return {
    appH: app ? Math.round(app.getBoundingClientRect().height) : -1,
    innerH: window.innerHeight,
    want: window.innerHeight - kb,
  };
}, KB);
checkNear('设置页同样让位', st.appH, st.want, 2);

// ── 5. 系统已经压过布局时，绝不重复让位 ─────────────
// 复刻 adjustResize 生效的情形：innerHeight 本身就变小了，可视高度与它相等。
// 此时差值必须是 0，否则「系统压一次 + 我们再减一次」= 上移两倍键盘高度。
await page.evaluate(() => {
  window.__setKb(0);
  delete window.__kbH; // 让假 visualViewport 重新跟随 innerHeight
});
await page.setViewport({ width: 390, height: 524, deviceScaleFactor: 2 });
await wait(400);
const resized = await geom();
check('系统已压缩布局时不再重复让位', resized.kb, '0px');
checkNear('系统已压缩时 app 高度 = 压缩后的高度', resized.appH, resized.innerH, 2);
checkTrue('系统已压缩时 app 没被多减去一截', resized.appH > 500);

check('无 JS 报错', errors.length ? errors[0] : 0, 0);

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
