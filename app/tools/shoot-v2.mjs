/**
 * V2「纸与食材」视觉回归截图。
 *
 * 覆盖（每张存 app/shots/v2-*.png）：
 *   今日页 0 摄入 / 有数据 / 超限   × 深 / 浅
 *   统计页 日 / 周 / 月             × 深 / 浅
 *   设置页、引导页                  × 深 / 浅
 *   360px 宽：微量 14 格展开（看等高与 .src 是否把菜名挤没）
 *
 * 两个刻意的做法：
 * 1. **主题走真 UI 切换**（设置页 .theme-seg），不是改 localStorage ——
 *    数据到位后 settings.theme 会覆盖首帧镜像，改 localStorage 只会骗到第一帧。
 * 2. **引导状态走真 UI 走完**（tools/lib/onboard.mjs），不是往 IndexedDB 里塞档案。
 *
 * 用法：npm run build && npx vite preview --port 4173 &
 *       node tools/shoot-v2.mjs [baseUrl]
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { completeOnboarding } from './lib/onboard.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = resolve(import.meta.dirname, '../shots');
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));

let n = 0;
async function shot(name) {
  await wait(260);
  const file = `${OUT}/v2-${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log('OK', file.replace(/.*shots[\\/]/, 'shots/'));
}

/** 用真 UI 切主题 */
async function setTheme(mode) {
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.theme-seg button', { timeout: 15000 });
  const label = mode === 'light' ? '浅色' : '深色';
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('.theme-seg button')].find((x) => x.textContent.includes(t));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!ok) throw new Error('切主题失败：' + label);
  await wait(450);
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

async function go(hash, sel) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle2', timeout: 30000 });
  if (sel) await page.waitForSelector(sel, { timeout: 20000 });
  await wait(320);
}

/** 在 /add 里按名字加一条食物 */
async function addFood(name) {
  await go('#/add', '.searchbox');
  await page.click('.searchbox input', { clickCount: 3 });
  await page.type('.searchbox input', name);
  await page.waitForSelector('.pickrow', { timeout: 8000 });
  await page.click('.pickrow .add');
  await wait(200);
}

/**
 * 把**最后加入**的那一项的克数抬上去（走真 UI 的 + 号）。
 * 「超限」这个状态必须真的超过目标 kcal：光靠「脂肪 77/57」这种单项超标，
 * 热量环还是绿色的，截出来和正常态一模一样 —— 那等于没拍。
 */
async function bumpLastItem(targetG) {
  for (let i = 0; i < 200; i++) {
    const cur = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.selitem')].pop()?.querySelector('.stepper b');
      return el ? Number(el.textContent.replace(/[^\d.]/g, '')) : 0;
    });
    if (!cur) throw new Error('找不到最后一项的克数');
    if (cur >= targetG) return cur;
    await page.evaluate(() => {
      const btns = [...([...document.querySelectorAll('.selitem')].pop()?.querySelectorAll('.stepper button') ?? [])];
      btns.find((b) => b.textContent.includes('+'))?.click();
    });
    await wait(25);
  }
  throw new Error('加不到目标克数：' + targetG);
}

/** 深/浅两版都拍一遍同一个状态 */
async function shotBoth(name) {
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    await go('#/', '.ringwrap');
    await shot(`${name}-${theme}`);
  }
}

async function saveMeal() {
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sheetbar button')].find((x) => x.textContent.trim() === '保存');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!ok) throw new Error('找不到保存按钮');
  await wait(700);
}

/* ── 0. 引导页（先拍，因为走完就没了） ─────────────────────────── */
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('.app, .welcome', { timeout: 20000 });
const welcome = await page.evaluate(() => Boolean(document.querySelector('.welcome')));
if (welcome) {
  // 引导页没有切主题的入口（那时还没进设置页），而 bootstrap 跑完后设置里的 theme
  // 是 'system' —— 会盖掉 localStorage 那份首帧镜像。所以这里只能走**系统偏好**
  // 这一条真链路：emulateMediaFeatures 就是浏览器告诉页面「系统是深色」的方式。
  for (const theme of ['dark', 'light']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('.welcome', { timeout: 20000 });
    await wait(400);
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (applied !== theme) throw new Error(`引导页主题没生效：期望 ${theme}，实际 ${applied}`);
    await shot(`welcome-${theme}`);
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.welcome', { timeout: 20000 });
  await completeOnboarding(page, { wait });
} else {
  console.log('[skip] 库里已有档案，不拍引导页');
}

/* ── 1. 今日页 · 0 摄入（深 / 浅） ─────────────────────────────── */
await setTheme('dark');
await go('#/', '.ringwrap');
await shot('today-empty-dark');
await setTheme('light');
await go('#/', '.ringwrap');
await shot('today-empty-light');

/* ── 2. 今日页 · 有数据（深 / 浅），顺便展开微量 14 格 ──────────── */
await addFood('米饭');
await addFood('鸡胸肉');
await addFood('西兰花');
await saveMeal();

for (const theme of ['dark', 'light']) {
  await setTheme(theme);
  await go('#/', '.ringwrap');
  await shot(`today-filled-${theme}`);
  // 展开微量 14 格
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.fold > button')].find((x) => x.textContent.includes('微量营养素'));
    if (!b) return false;
    b.click();
    return true;
  });
  if (opened) {
    await page.waitForSelector('.mgrid .mcell', { timeout: 8000 });
    await page.evaluate(() => {
      const m = document.querySelector('.main');
      if (m) m.scrollTop = m.querySelector('.mgrid').getBoundingClientRect().top + m.scrollTop - 220;
    });
    await shot(`today-micro-${theme}`);
  }
}

/* ── 3. 今日页 · 超限（深 / 浅） ─────────────────────────────────
   必须真的把**热量**顶过目标（2248），不是只让某一条宏量超标：
   环是按 kcal 变色的，脂肪超了但热量没超时环还是绿的，截出来和正常态一样。 */
await addFood('大豆油');
await bumpLastItem(60);
await addFood('五花肉');
await bumpLastItem(200);
await addFood('花生');
await bumpLastItem(100);
await saveMeal();
await go('#/', '.ringwrap');
{
  const total = await page.evaluate(() => {
    const m = document.body.innerText.match(/([\d,]+)\s*已摄入/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  });
  console.log('  超限态总热量 =', total, 'kcal');
  if (total == null || total < 2248) throw new Error(`没真的超限（${total} kcal），这张图会骗人`);
}

await shotBoth('today-over');

/* ── 4. 统计页 日 / 周 / 月 × 深 / 浅 ──────────────────────────── */
for (const theme of ['dark', 'light']) {
  await setTheme(theme);
  await go('#/stats', '.ptabs');
  for (const [label, name] of [['周', 'week'], ['月', 'month'], ['季', 'quarter']]) {
    const ok = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('.seg button')].find((x) => x.textContent.trim() === t);
      if (!b) return false;
      b.click();
      return true;
    }, label);
    if (!ok) { console.log('[warn] 找不到周期按钮', label); continue; }
    await wait(420);
    await page.screenshot({ path: `${OUT}/v2-${String(++n).padStart(2, '0')}-stats-${name}-${theme}.png` });
    console.log(`OK shots/v2-${String(n).padStart(2, '0')}-stats-${name}-${theme}.png`);
  }
}

/* ── 5. 设置页 × 深 / 浅 ───────────────────────────────────────── */
for (const theme of ['dark', 'light']) {
  await setTheme(theme);
  await go('#/settings', '.seg');
  await shot(`settings-${theme}`);
}

/* ── 6. 360px 窄屏：微量 14 格等高 / 菜名是否被 .src 挤没 ────────── */
await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2 });
for (const theme of ['dark', 'light']) {
  await setTheme(theme);
  await go('#/', '.ringwrap');
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.fold > button')].find((x) => x.textContent.includes('微量营养素'));
    if (!b) return false;
    b.click();
    return true;
  });
  if (opened) {
    await page.waitForSelector('.mgrid .mcell', { timeout: 8000 });
    await wait(250);
    // 量 14 格：等高？左缘对齐？（这两条是去底色后「表感」的全部来源）
    const geo = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.mgrid .mcell')];
      const hs = cells.map((c) => Math.round(c.getBoundingClientRect().height * 10) / 10);
      const ls = cells.map((c) => Math.round(c.getBoundingClientRect().left));
      return { count: cells.length, minH: Math.min(...hs), maxH: Math.max(...hs), cols: [...new Set(ls)] };
    });
    console.log('  微量 14 格 @360:', JSON.stringify(geo));
    await page.evaluate(() => {
      const m = document.querySelector('.main');
      if (m) m.scrollTop = m.querySelector('.mgrid').getBoundingClientRect().top + m.scrollTop - 200;
    });
    await shot(`360-micro-${theme}`);
  }
  // 今日记录展开：看长菜名 + .src 那一行
  const rec = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.fold.plain > button')].find((x) => x.textContent.includes('今日记录'));
    if (!b) return false;
    b.click();
    return true;
  });
  if (rec) {
    await wait(320);
    await shot(`360-records-${theme}`);
  }
}

/* ── 7. 编辑一餐（与拍照识别结果页同一套 .selitem / .stepper / .tiers3） ── */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
for (const theme of ['dark', 'light']) {
  await setTheme(theme);
  await go('#/', '.ringwrap');
  const rec = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.fold.plain > button')].find((x) => x.textContent.includes('今日记录'));
    if (!b) return false;
    b.click();
    return true;
  });
  if (rec) {
    await wait(320);
    await page.click('.meal .edit');
    await page.waitForSelector('.selitem', { timeout: 10000 });
    await wait(400);
    await shot(`meal-edit-${theme}`);
  }
}

console.log(errors.length ? `\n[console] ${errors.length} 条错误：\n  ` + errors.slice(0, 6).join('\n  ') : '\n[console] 无错误');
await browser.close();
