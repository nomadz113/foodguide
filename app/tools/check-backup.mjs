/**
 * 备份端到端验证：两个端口 = 两个 origin，IndexedDB 天然隔离。
 *
 * 单测能证明合并规则对，但证明不了「文件真的落到了磁盘上、真的能被另一个 origin 读出来」。
 * 而用户真正在意的就是后者 —— 换入口以后记录还在不在。所以这里跑真实浏览器：
 *   端口 4173 上塞一条餐次 → 点导出 → 端口 4174 上点导入 → 查另一个库的记录。
 *
 * 顺带验证幂等：同一个文件连导两次，记录数不能变成 2。
 */
import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const A = 'http://localhost:4173';
const B = 'http://localhost:4174';
const DL = resolve(process.cwd(), 'tools/.downloads');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got}${ok ? '' : ` want=${want}`}`);
};
const checkTrue = (name, got) => check(name, !!got, true);

rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const errors = [];
let lastDialog = '';

async function openPage(base) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${base} PAGEERROR ${e.message.slice(0, 160)}`));
  page.on('dialog', async (d) => {
    lastDialog = d.message();
    await d.accept();
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle2' });
  await wait(1200);
  return page;
}

/** 直接往 IndexedDB 塞一条餐次 —— 比点 UI 记账快，且同样能验证「既有数据能被导出」 */
async function seedMeal(page, name, date) {
  await page.evaluate(async (mealName, day) => {
    const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium', 'potassium',
      'calcium', 'iron', 'zinc', 'selenium', 'magnesium', 'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin'];
    const facts = (kcal) => Object.fromEntries(keys.map((k) => [k, k === 'kcal' ? kcal : 1]));
    const meal = {
      id: `meal_${mealName}`, date: day, eatenAt: Date.now(), slot: 'lunch',
      source: 'manual', photoId: null,
      items: [{
        id: 'i1', name: mealName, rawName: null, parentDish: null, foodId: null,
        matchType: 'manual', matchScore: null, grams: 200, baseG: 200, portionTier: 'medium',
        tierConfirmed: false, quantity: null, unit: null, gramSource: 'user',
        per100g: facts(150), nutrition: facts(300), fieldSource: {},
        components: null, confidence: 1, locked: false,
      }],
      totals: facts(300), coverage: { kcal: 1 }, goalId: null, aiMeta: null,
      createdAt: Date.now(), deletedAt: null,
    };
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('daily-intake');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('meals', 'readwrite');
      tx.objectStore('meals').put(meal);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }, name, date);
}

async function countMeals(page) {
  return page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('daily-intake');
      r.onsuccess = () => res(r.result);
    });
    return new Promise((res) => {
      const tx = db.transaction('meals', 'readonly');
      const q = tx.objectStore('meals').count();
      q.onsuccess = () => res(q.result);
    });
  });
}

async function gotoSettings(page) {
  await page.evaluate(() => { location.hash = '#/profile'; });
  await wait(500);
  await page.evaluate(() => {
    [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('设置'))?.click();
  });
  await wait(700);
}

const tapText = async (page, text) => {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    if (!el) return false;
    el.click();
    return true;
  }, text);
  await wait(400);
  return ok;
};

// ── A：造数据并导出 ────────────────────────────────────────
const pageA = await openPage(A);
await seedMeal(pageA, '备份测试餐', '2026-10-21');
await gotoSettings(pageA);
check('A 设置页显示餐次条数', await pageA.evaluate(() => {
  const row = [...document.querySelectorAll('.krow')].find((r) => r.textContent.includes('餐次'));
  return row?.querySelector('.v')?.textContent?.replace(/\D/g, '') ?? 'none';
}), '1');

checkTrue('点「导出备份」', await tapText(pageA, '导出备份'));
await wait(1500);

const files = readdirSync(DL).filter((f) => f.endsWith('.json'));
check('导出文件已落地', files.length >= 1, true);
if (files.length < 1) {
  console.log('下载目录内容：', readdirSync(DL));
  await browser.close();
  process.exit(1);
}
const raw = readFileSync(resolve(DL, files[0]), 'utf8');
const backup = JSON.parse(raw);
check('文件格式标记', backup.format, 'daily-intake-backup');
check('导出含刚记的餐次', backup.data.meals.length, 1);
check('餐次名称正确', backup.data.meals[0]?.items?.[0]?.name, '备份测试餐');
check('不含内置食物', backup.data.foods.filter((f) => f.source === 'preset').length, 0);
check('默认不含 API Key', backup.data.settings?.apiKeyCipher ?? null, 'null');
console.log(`  文件大小 ${(raw.length / 1024).toFixed(0)} KB`);

// ── B：导入 ───────────────────────────────────────────────
const pageB = await openPage(B);
await seedMeal(pageB, '本机原有的餐', '2026-10-22'); // 本地也有数据，验证不会被覆盖掉
await gotoSettings(pageB);

async function importFile(page, path) {
  const [chooser] = await Promise.all([
    page.waitForFileChooser(),
    tapText(page, '导入备份'),
  ]);
  await chooser.accept([path]);
  await wait(900);
  const shown = await page.evaluate(() => document.body.innerText.includes('确认合并'));
  if (!shown) return false;
  await tapText(page, '确认合并');
  await wait(1500);
  return true;
}

const filePath = resolve(DL, files[0]);
checkTrue('导入后弹出「确认合并」预览', await importFile(pageB, filePath));
check('B 导入后餐次 = 本机原有 + 备份', await countMeals(pageB), 2);
checkTrue('导入回执有内容', lastDialog.includes('导入完成'));

// 幂等：同一个文件再导一次
await gotoSettings(pageB);
checkTrue('第二次导入同一文件', await importFile(pageB, filePath));
check('重复导入不产生重复记录', await countMeals(pageB), 2);
checkTrue('重复导入提示无变化', lastDialog.includes('没有任何变化'));

// 本机原有的记录没被动过
const names = await pageB.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('daily-intake');
    r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const tx = db.transaction('meals', 'readonly');
    const q = tx.objectStore('meals').getAll();
    q.onsuccess = () => res(q.result.map((m) => m.items[0]?.name));
  });
});
check('本机原有记录仍在', names.includes('本机原有的餐'), true);
check('备份记录已进来', names.includes('备份测试餐'), true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (errors.length) console.log('页面错误：', errors.slice(0, 5));
if (failed.length || errors.length) process.exitCode = 1;

await browser.close();
