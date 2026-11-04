/**
 * 首次引导流实测：0.9.5 的主打变更，之前没有任何脚本覆盖它。
 *
 * 验的是「新人第一次装这个 App 会发生什么」，共两段：
 *
 *   空库 → 必须停在引导页第一步，**不能**直接进首页（旧版本会凭空写一份
 *   175cm/78kg 的档案并把算好的热量目标显示给用户，那套数字与使用者无关）
 *   填完三步 → 进首页；再 reload → **直接进首页**（onboardedAt 真的落库了，
 *   不是只活在内存里）
 *
 * 用独立 userDataDir 启动浏览器，保证 IndexedDB 是真空的。之前吃过亏：
 * 在同一个 profile 里「先加载再清库」，量到的还是上次的残留状态。
 *
 * 用法：node tools/check-onboard.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SHOTS = resolve(import.meta.dirname, '../../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const profileDir = await mkdtemp(join(tmpdir(), 'onboard-'));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  userDataDir: profileDir,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const errors = [];
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE ${m.text().slice(0, 160)}`);
});

const fail = [];
const ok = [];
const check = (cond, label, detail = '') => {
  if (cond) ok.push(label);
  else fail.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

/** 把值写进非受控 input：走原生 setter + input 事件，React 才会读到 */
const setNative = (sel, value) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, sel, value);

const h1 = () => page.evaluate(() => document.querySelector('h1')?.textContent?.trim() ?? '');
const clickText = (text) => page.evaluate((t) => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
  if (!btn) return false;
  btn.click();
  return true;
}, text);
const nextDisabled = () => page.evaluate(() => document.querySelector('.wnext')?.disabled ?? null);

try {
  // ── ① 空库首启 ─────────────────────────────────────────
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2', timeout: 45000 });
  // 引导页的根是 .welcome，**不在** .app 里（未完成引导不挂载业务页面），
  // 所以这里不能等 .app —— 等错了会永远等不到。
  await page.waitForSelector('.app, .welcome', { timeout: 20000 });

  const first = await page.evaluate(() => ({
    hasWelcome: Boolean(document.querySelector('.welcome')),
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    count: document.querySelector('.wcount')?.textContent?.trim() ?? '',
    tabbar: document.querySelectorAll('.tabbar a').length,
    stepDots: document.querySelectorAll('.wstep span').length,
    hasBmi: Boolean(document.querySelector('.wsum-v')),
    unsure: document.querySelectorAll('.field.unsure, .seg.unsure').length,
    nextDisabled: document.querySelector('.wnext')?.disabled ?? null,
    sampleHeight: document.querySelectorAll('.wbody input[type=number]')[0]?.value ?? '',
  }));

  check(first.hasWelcome, '空库首启停在引导页');
  check(!first.tabbar, '引导页没有底部导航（还不在 Shell 里）', `实际 ${first.tabbar} 个 tab`);
  check(first.h1 === '你的身体数据', '第一步标题正确', `实际「${first.h1}」`);
  check(first.count === '第 1 步，共 3 步', '步进计数正确', `实际「${first.count}」`);
  check(first.stepDots === 3, '步进指示器 3 个点', `实际 ${first.stepDots}`);
  check(first.hasBmi, '实时 BMI 已展示');
  check(first.nextDisabled === true, '示例数据下「下一步」默认禁用');
  check(first.unsure === 4, '四个示例值字段都标成待确认（虚线）', `实际 ${first.unsure}`);
  check(first.sampleHeight !== '', '身高框有示例值（提示用户改）', `实际「${first.sampleHeight}」`);
  await page.screenshot({ path: join(SHOTS, 'onboard-1.png') });

  // ── ② 填第一步 ─────────────────────────────────────────
  await setNative('input[type=date]', '1994-06-15');
  await wait(120);
  const nums = await page.evaluate(() => [...document.querySelectorAll('.wbody input[type=number]')].map((e) => e.value));
  // 身高 / 体重是前两个 number 输入框
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('.wbody input[type=number]')];
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(els[0], '172');
    set(els[1], '71.5');
  });
  await wait(200);

  // 性别还没点过 → 仍应禁用。这一步专门盯「示例值只要合法就能过」的口子
  const halfDone = await page.evaluate(() => ({
    nextDisabled: document.querySelector('.wnext')?.disabled ?? null,
    left: document.querySelectorAll('.field.unsure, .seg.unsure').length,
  }));
  check(halfDone.nextDisabled === true, '只填了日期和身高体重、没确认性别时仍不能下一步', `剩余虚线 ${halfDone.left}`);

  await clickText('男');
  await wait(250);

  const afterFill = await page.evaluate(() => ({
    nextDisabled: document.querySelector('.wnext')?.disabled ?? null,
    bmi: document.querySelector('.wsum-v')?.textContent?.trim() ?? '',
    bmr: document.querySelector('.wsum-split b')?.textContent?.trim() ?? '',
    unsure: document.querySelectorAll('.field.unsure, .seg.unsure').length,
  }));
  check(afterFill.nextDisabled === false, '四项都确认后可以下一步', `默认值 ${JSON.stringify(nums)}`);
  check(afterFill.unsure === 0, '确认后虚线消失', `剩余 ${afterFill.unsure}`);
  // 172cm / 71.5kg → BMI 24.2
  check(afterFill.bmi.startsWith('24.2'), 'BMI 由填写值实时算出', `实际「${afterFill.bmi}」`);
  check(/\d/.test(afterFill.bmr), '实时显示基础代谢');

  await clickText('下一步');
  await wait(350);
  check((await h1()) === '你想达到什么', '进入第二步');

  // ── ③ 第二步：选「维持」，不需要目标体重 ───────────────
  await clickText('维持');
  await wait(250);
  await page.screenshot({ path: join(SHOTS, 'onboard-2.png') });
  const s2 = await page.evaluate(() => ({
    nextDisabled: document.querySelector('.wnext')?.disabled ?? null,
    kcal: document.querySelector('.wsum-v')?.textContent?.trim() ?? '',
    needsTarget: document.querySelectorAll('.wbody input[type=number]').length,
  }));
  check(s2.nextDisabled === false, '「维持」不需要目标体重即可下一步');
  check(s2.needsTarget === 0, '非减脂/增肌时不显示目标体重输入', `实际 ${s2.needsTarget} 个 number 框`);
  check(/kcal/.test(s2.kcal), '显示每天目标热量', `实际「${s2.kcal}」`);

  await clickText('下一步');
  await wait(350);
  check((await h1()) === '拍照识别需要 AI', '进入第三步');

  // ── ④ 第三步：先不用 AI → 开始使用 ─────────────────────
  const s3 = await page.evaluate(() => ({
    nextDisabled: document.querySelector('.wnext')?.disabled ?? null,
    choices: document.querySelectorAll('.wchoice').length,
  }));
  check(s3.choices === 2, 'AI 步骤给两个明确选项', `实际 ${s3.choices}`);
  check(s3.nextDisabled === true, '未做选择前「开始使用」禁用');

  await clickText('先不用 AI');
  await wait(200);
  await page.screenshot({ path: join(SHOTS, 'onboard-3.png') });
  check((await nextDisabled()) === false, '选完 AI 选项后可以开始');

  await clickText('开始使用');
  await page.waitForSelector('.tabbar a', { timeout: 15000 }).catch(() => {});
  await wait(900);

  const home = await page.evaluate(() => ({
    welcome: Boolean(document.querySelector('.welcome')),
    tabbar: document.querySelectorAll('.tabbar a').length,
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    knocks: [...document.querySelectorAll('.k')].map((e) => e.textContent?.trim()).slice(0, 3),
  }));
  check(!home.welcome, '完成后离开引导页');
  check(home.tabbar >= 4, '进入首页后底部导航出现', `实际 ${home.tabbar} 个 tab`);
  await page.screenshot({ path: join(SHOTS, 'onboard-4-home.png') });

  // ── ⑤ reload 后不再回引导页 ────────────────────────────
  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.tabbar a', { timeout: 15000 }).catch(() => {});
  await wait(700);
  const again = await page.evaluate(() => ({
    welcome: Boolean(document.querySelector('.welcome')),
    tabbar: document.querySelectorAll('.tabbar a').length,
  }));
  check(!again.welcome && again.tabbar >= 4, 'onboardedAt 已落库：reload 直接进首页');
} catch (e) {
  fail.push(`脚本异常 ${e.message.slice(0, 200)}`);
} finally {
  await browser.close().catch(() => {});
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

for (const line of ok) console.log(`  PASS  ${line}`);
for (const line of fail) console.log(`  FAIL  ${line}`);
if (errors.length) {
  console.log('\n浏览器报错：');
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(`  ${e}`);
}

const hardFail = fail.length > 0 || errors.filter((e) => e.startsWith('PAGEERROR')).length > 0;
console.log(`\n${hardFail ? 'FAIL' : 'PASS'} — ${ok.length} 通过 / ${fail.length} 失败`);
process.exit(hardFail ? 1 : 0);
