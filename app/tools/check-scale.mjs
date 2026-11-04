/**
 * 截图录入体重的端到端冒烟。
 *
 * 单测能证明 guard/parse 算得对，证不了「路由通不通、页面挂不挂得住」。
 * 这里用真实浏览器走一遍：档案页入口 → 跳转 → 无 Key 时的引导 → 控制台干净。
 *
 * 刻意**不测识别**：那要真 API 且每次花钱，识别质量由 tools/keep-photo-probe.mjs 负责。
 * 保存逻辑（upsertWeightScale / 是否同步档案）由 repo.scale.test.ts 与 scale/time.test.ts 覆盖。
 *
 * 用法：node tools/check-scale.mjs http://127.0.0.1:4173/
 */
import puppeteer from 'puppeteer-core';

const TARGET = process.argv[2] ?? 'http://127.0.0.1:4173/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const bad = (m) => fails.push(m);

// 托管站取 manifest.webmanifest 会固定 403（查询串凭证带不过去），是部署环境特性不是缺陷
const NOISE = [/manifest\.webmanifest/i, /status of 403/i];
const consoleErrors = [];

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => page.evaluate(() => document.body.innerText || '');

async function goto(hash) {
  await page.goto(`${TARGET}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.app', { timeout: 60_000 });
  await sleep(1200);
}

async function clickByText(label) {
  return page.evaluate((l) => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(l));
    if (!el) return false;
    el.click();
    return true;
  }, label);
}

try {
  // ① 档案页要有入口
  await goto('/profile');
  let t = await text();
  if (t.includes('从 Keep 截图识别')) ok('档案页有「从 Keep 截图识别」入口');
  else bad(`档案页缺少入口（页面片段：${t.slice(0, 120)}）`);

  // ② 点进去要能到 /scale
  const clicked = await clickByText('从 Keep 截图识别');
  if (!clicked) bad('入口按钮点不到');
  await sleep(900);
  const hash = await page.evaluate(() => location.hash);
  if (hash.includes('/scale')) ok(`跳转到 ${hash}`);
  else bad(`没跳到 /scale（当前 ${hash}）`);

  // ③ 页面自己挂起来了
  t = await text();
  if (t.includes('从截图记体重')) ok('页面标题「从截图记体重」');
  else bad(`页面标题缺失（片段：${t.slice(0, 120)}）`);

  // ④ 没有 API Key 时必须给去设置的引导，且按钮不可点（点开相册也识别不了）
  if (t.includes('还没填 API Key')) ok('无 Key 时给出设置引导');
  else bad(`无 Key 时没有引导（片段：${t.slice(0, 160)}）`);

  const btnDisabled = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('从相册选截图'));
    return el ? el.disabled : null;
  });
  if (btnDisabled === true) ok('无 Key 时「从相册选截图」是禁用的');
  else bad(`无 Key 时按钮未禁用（disabled=${btnDisabled}）`);

  // ⑤ 取消能回去
  const cancelled = await clickByText('取消');
  if (cancelled) {
    await sleep(700);
    const back = await page.evaluate(() => location.hash);
    if (back.includes('/profile')) ok('「取消」回到档案页');
    else bad(`「取消」没回档案页（${back}）`);
  }
} catch (e) {
  bad(`脚本异常：${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
}

const real = consoleErrors.filter((e) => !NOISE.some((re) => re.test(e)));
if (real.length === 0) ok('无控制台错误');
else bad(`控制台错误：${real.slice(0, 3).join(' | ')}`);

console.log('=== 结果 ===');
for (const o of oks) console.log('  ✓', o);
for (const f of fails) console.log('  ✗', f);
console.log(fails.length === 0 ? '\nPASS' : `\nFAIL (${fails.length}/${oks.length + fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
