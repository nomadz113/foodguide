/**
 * 截图录入的「真机路径」验证 —— 会调用真实 API，不进常规回归。
 *
 * 为什么还需要这个脚本，明明已经有了两个：
 * - keep-photo-probe.mjs 验证提示词对假截图的识别率，但它是 **Node 直接发 JPEG**，
 *   没有经过浏览器里的 compressForVision（canvas 解码 → 缩放 → 重编码）。
 * - check-scale.mjs 验证路由和页面挂载，但没有 API Key，走不到识别。
 *
 * 真机上真正发生的是两者的组合：截图 → **浏览器 canvas 压缩** → 模型。
 * 这一环是整条链路最可能翻车的地方（1024px/q0.82 那套参数在体脂秤的小字上会糊），
 * 所以必须有一次走完整页面的验证。
 *
 * 做的事：注入 .env.local 的 Key 到 IndexedDB → 上传 testphotos 里的假截图 →
 * 等识别 → 检查表单被填对 → 点保存 → 检查档案体重真的变了。
 *
 * 用法：node tools/check-scale-live.mjs [http://127.0.0.1:4173/]
 */
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { loadEnv } from './env.mjs';

const TARGET = process.argv[2] ?? 'http://127.0.0.1:4173/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
/** 三天前的截图：属于补录，只进趋势、不改档案 */
const SHOT_OLD = resolve('testphotos', 'keep-scale-detail.jpg');
/** 今天的截图：应当更新档案 */
const SHOT_TODAY = resolve('testphotos', 'keep-scale-list.jpg');
/** 时间栏只印了日期、没有时分的那张 —— Keep 列表页就是这种形态 */
const SHOT_DAYONLY = resolve('testphotos', 'keep-scale-avg.jpg');

const env = loadEnv();
const KEY = env.DASHSCOPE_API_KEY;
if (!KEY) {
  console.error('缺少 DASHSCOPE_API_KEY，检查 app/.env.local');
  process.exit(1);
}

/** 与 core/ai/keyStore.ts 的 obfuscate 等价：XOR 'ni-guide-2026' + base64 */
const MASK = 'ni-guide-2026';
function obfuscate(key) {
  const mask = Buffer.from(MASK, 'utf8');
  const bytes = Buffer.from(key.trim(), 'utf8');
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i % mask.length];
  return bytes.toString('base64');
}

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const bad = (m) => fails.push(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

/** 按 label 文案取数字输入框的值（NumInput 是非受控，直接读 value） */
const fieldValue = (label) =>
  page.evaluate((l) => {
    for (const f of document.querySelectorAll('.field')) {
      const t = f.querySelector('span')?.textContent ?? '';
      if (t.includes(l)) return f.querySelector('input')?.value ?? null;
    }
    return null;
  }, label);

try {
  await page.goto(`${TARGET}#/scale`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.app', { timeout: 60_000 });
  await sleep(1200);

  // ── 注入 Key（bootstrap 已经把默认 settings 建好了，这里只改那一行）
  const cipher = obfuscate(KEY);
  await page.evaluate(async (c) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('daily-intake');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      const g = st.get('app');
      g.onsuccess = () => {
        const s = g.result;
        s.apiKeyCipher = c;
        st.put(s);
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, cipher);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app');
  await sleep(1200);

  const t0 = await page.evaluate(() => document.body.innerText);
  if (t0.includes('还没填 API Key')) bad('注入 Key 后仍判定为未配置');
  else ok('Key 注入生效，识别入口可用');

  /** 上传一张截图 → 等识别完成，返回页面文字 */
  async function recogniseShot(path) {
    const started = Date.now();
    await page.goto(`${TARGET}#/scale`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app');
    await sleep(1000);
    const input = await page.$('input[type="file"]');
    if (!input) throw new Error('找不到文件输入框');
    await input.uploadFile(path);
    await page.waitForFunction(
      () => {
        const b = document.querySelector('.sheetbar button.primary');
        return b && !b.disabled;
      },
      { timeout: 90_000 },
    );
    return { body: await page.evaluate(() => document.body.innerText), ms: Date.now() - started };
  }

  async function saveAndReadWeight() {
    await page.evaluate(() => document.querySelector('.sheetbar button.primary').click());
    await page.waitForFunction(() => location.hash.includes('/profile'), { timeout: 30_000 });
    await sleep(1200);
    return fieldValue('体重 kg');
  }

  // 初始体重必须去档案页读 —— /scale 的「体重 kg」输入框只在识别完成后才渲染
  await page.goto(`${TARGET}#/profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app');
  await sleep(1000);
  const initialWeight = Number(await fieldValue('体重 kg'));
  if (!Number.isFinite(initialWeight) || initialWeight <= 0) bad(`读不到初始档案体重：${initialWeight}`);

  // ── ① 三天前的截图：补录，不该改档案
  const a = await recogniseShot(SHOT_OLD);
  ok(`识别完成并用时 ${(a.ms / 1000).toFixed(1)}s`);
  if (Math.abs(Number(await fieldValue('体重')) - 72.4) < 0.05) ok('体重填入 72.4');
  else bad(`体重没填对：${await fieldValue('体重')}`);
  if (Math.abs(Number(await fieldValue('体脂率')) - 22.8) < 0.05) ok('体脂率填入 22.8');
  else bad(`体脂率没填对：${await fieldValue('体脂率')}`);
  if (a.body.includes('保存后会怎样')) ok('展示「保存后会怎样」后果预告');
  else bad('缺少后果预告卡片');
  if (a.body.includes('Katch')) ok('提示体脂率会切换 BMR 公式');
  else bad('没有提示 BMR 公式切换');

  // 这一条是 shouldSyncProfile 的运行时证明：补录不该把档案的当前体重改回旧值
  if (a.body.includes('只进趋势')) ok('三天前的记录被识别为补录（提示只进趋势）');
  else bad('补录记录没有给出「只进趋势」提示');

  const afterOld = Number(await saveAndReadWeight());
  if (afterOld === initialWeight) ok(`补录后档案体重保持不变（${afterOld}）`);
  else bad(`补录却改了档案体重：${initialWeight} → ${afterOld}`);

  // ── ② 今天的截图：应当更新档案
  const b = await recogniseShot(SHOT_TODAY);
  if (b.body.includes('档案体重会更新为')) ok('今天的记录提示会更新档案');
  else bad('今天的记录没有给出「会更新档案」提示');

  const afterToday = Number(await saveAndReadWeight());
  if (Math.abs(afterToday - 72.4) < 0.05) ok(`档案体重已更新为 ${afterToday}`);
  else bad(`档案体重没更新：${afterToday}`);

  // ── ③ 页面只印日期（没有时分）：时分必须从截图文件时间借，不能留在 0:00
  const c = await recogniseShot(SHOT_DAYONLY);
  const whenC = await page.evaluate(
    () => document.querySelector('input[aria-label="测量时间"]')?.value ?? '',
  );
  if (!whenC) bad('读不到测量时间输入框');
  else if (whenC.endsWith('T00:00')) bad(`只印日期时时间仍是 0 点 0 分（${whenC}）`);
  else ok(`只印日期时补出了时分 ${whenC.replace('T', ' ')}`);
  if (c.body.includes('时分取自截图时间')) ok('界面说明了时分来自截图时间');
  else bad('没有说明时分是从哪来的');

  if (pageErrors.length) bad(`页面异常：${pageErrors.slice(0, 2).join(' | ')}`);
} catch (e) {
  bad(`脚本异常：${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
}

console.log('=== 结果 ===');
for (const o of oks) console.log('  ✓', o);
for (const f of fails) console.log('  ✗', f);
console.log(fails.length === 0 ? '\nPASS' : `\nFAIL (${fails.length}/${oks.length + fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
