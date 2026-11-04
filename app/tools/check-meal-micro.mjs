/**
 * 「这一餐的矿物质」渲染验证 —— 只跑本地 dist，不调 AI，可进常规回归。
 *
 * 为什么要这个脚本：矿物质那一行和六格汇总都是纯排版，
 * 单测只覆盖到 core/nutrition/minerals.ts 返回的数字，
 * 覆盖不到「chip 会不会溢出卡片」「汇总卡有没有真被渲染」「点 + 之后数字跟不跟着变」。
 *
 * 做法：直接往 IndexedDB 插一条造好的餐（一项有库数据、一项没匹配上），
 * 打开编辑页，读 DOM 断言，再点一次「+」验证克数与矿物质同步。
 *
 * 用法：node tools/check-meal-micro.mjs [http://127.0.0.1:4173/]
 */
import puppeteer from 'puppeteer-core';
import { completeOnboarding } from './lib/onboard.mjs';

const TARGET = process.argv[2] ?? 'http://127.0.0.1:4173/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const MEAL_ID = 'meal_micro_check';

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const bad = (m) => fails.push(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一项有完整库数据、一项完全没匹配上 */
function seedMeal(nowMs) {
  const d = new Date(nowMs);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const facts = (o) => ({
    kcal: null, protein: null, fat: null, carbs: null, fiber: null, sugar: null,
    sodium: null, potassium: null, calcium: null, iron: null, zinc: null,
    selenium: null, magnesium: null, va: null, vc: null, vd: null, ve: null,
    b1: null, b2: null, niacin: null, ...o,
  });
  const base = {
    rawName: null, parentDish: null, matchScore: null, portionTier: 'medium',
    tierConfirmed: false, quantity: null, unit: null, gramSource: 'ai',
    components: null, confidence: 0.9, locked: false, fieldSource: {},
  };
  const meat = {
    ...base,
    id: 'item_meat', name: '猪瘦肉丝', foodId: 'food_meat', matchType: 'library',
    grams: 100, baseG: 100,
    // 改克数时 scaleFacts 只读 per100g，nutrition 会被整份重算 ——
    // 所以 per100g 必须带上矿物质，否则点一下 + 它们就全丢了。
    // （真实链路里 matchAndFill 补的正是 per100g，快照只是它的派生值）
    per100g: facts({
      kcal: 143, protein: 20.3, fat: 6.2, carbs: 1.5,
      calcium: 6, iron: 1.3, zinc: 2.9, selenium: 9.5, potassium: 305, magnesium: 25,
    }),
    nutrition: facts({
      kcal: 143, protein: 20.3, fat: 6.2, carbs: 1.5,
      calcium: 6, iron: 1.3, zinc: 2.9, selenium: 9.5, potassium: 305, magnesium: 25,
    }),
    fieldSource: {
      calcium: 'library', iron: 'library', zinc: 'library',
      selenium: 'library', potassium: 'library', magnesium: 'library',
      kcal: 'ai', protein: 'ai', fat: 'ai', carbs: 'ai',
    },
  };
  const cumin = {
    ...base,
    id: 'item_cumin', name: '孜然粉', foodId: null, matchType: 'ai',
    grams: 15, baseG: 15,
    per100g: facts({ kcal: 113, protein: 4, fat: 5, carbs: 12 }),
    nutrition: facts({ kcal: 17, protein: 0.6, fat: 0.8, carbs: 1.8 }),
  };
  const items = [meat, cumin];
  return {
    id: MEAL_ID,
    date,
    eatenAt: nowMs,
    slot: 'lunch',
    source: 'photo',
    photoId: null,
    items,
    totals: facts({ kcal: 160, protein: 20.9, fat: 7, carbs: 3.3 }),
    coverage: {},
    goalId: null,
    aiMeta: null,
    createdAt: nowMs,
    deletedAt: null,
  };
}

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

try {
  // 先进首页让 bootstrap 把库和默认档案（含 goal.micro）建好
  await page.goto(`${TARGET}#/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.app, .welcome', { timeout: 60_000 });
  await sleep(1500);
  // 全新的 Puppeteer 配置目录没有档案 → 会被引导页拦在前面，
  // 后面 `#/meal/:id` 永远等不到 .selitem。这条脚本写在引导流之前，
  // 之前一直靠「手工先跑过一次」才通过；这里补上真 UI 走引导。
  if (await page.evaluate(() => Boolean(document.querySelector('.welcome')))) {
    await completeOnboarding(page, { wait: sleep });
    await sleep(600);
  }

  // ── 插一条造好的餐
  await page.evaluate(async (meal) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('daily-intake');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('meals', 'readwrite');
      tx.objectStore('meals').put(meal);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, seedMeal(Date.now()));

  await page.goto(`${TARGET}#/meal/${MEAL_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.selitem', { timeout: 30_000 });
  await sleep(900);

  // ── 每项那一行（纯文字：一项一个 .mgtext，不再是 .mgchip 色块）
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.selitem')].map((c) => ({
      name: c.querySelector('.top input')?.value ?? '',
      segs: [...c.querySelectorAll('.mtext .mgtext')].map((x) => x.textContent.trim()),
      // 每行几项：6 项应该是 [5, 1]（第一行满，第二行补齐）
      rowLens: [...c.querySelectorAll('.mtext .mrow')].map(
        (r) => r.querySelectorAll('.mgtext').length,
      ),
      text: c.querySelector('.mtext')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      none: c.querySelector('.mgnone')?.textContent?.trim() ?? null,
      more: c.querySelector('.mgmore')?.textContent?.trim() ?? null,
      // 文字流不该出现横向滚动条：项内 nowrap 一旦比容器宽就会露出来
      overflow: c.querySelector('.microline')
        ? c.querySelector('.microline').scrollWidth > c.querySelector('.microline').clientWidth + 1
        : null,
    })),
  );

  if (items.length !== 2) bad(`食物项数量 ${items.length}，期望 2`);
  else ok('两项食物都渲染出来了');

  const meat = items.find((x) => x.name.includes('猪瘦肉')) ?? {};
  const cumin = items.find((x) => x.name.includes('孜然')) ?? {};

  if (meat.segs?.length === 6) ok(`猪瘦肉丝列出 6 项矿物质：${meat.segs.join(' ')}`);
  else bad(`猪瘦肉丝的矿物质项数 ${meat.segs?.length}，期望 6`);

  const lens = (meat.rowLens ?? []).join('+');
  if (lens === '5+1') ok('六项排成 5+1 两行');
  else bad(`行分布是 ${lens || '(无)'}，期望 5+1`);

  // 每项文本不能自己折行：折了说明 nowrap 没生效，「钙」会和数字分家
  const unbroken = await page.evaluate(() => {
    const el = document.querySelector('.mtext .mgtext');
    if (!el) return null;
    const lh = parseFloat(getComputedStyle(el.parentElement).lineHeight) || 20;
    return el.getBoundingClientRect().height <= lh + 2;
  });
  if (unbroken === true) ok('单项没有内部折行');
  else bad(`单项被折成多行（height 超过一行行高）：${unbroken}`);

  const hasCalcium = meat.segs?.some((t) => t.includes('钙') && t.includes('6') && t.includes('mg'));
  if (hasCalcium) ok('钙 6mg 显示正确');
  else bad(`没找到「钙 6mg」，实际：${meat.segs?.join(' | ')}`);

  const hasSelenium = meat.segs?.some((t) => t.includes('硒') && t.includes('9.5') && t.includes('μg'));
  if (hasSelenium) ok('硒 9.5μg 带对了单位');
  else bad(`硒的单位不对：${meat.segs?.join(' | ')}`);

  // 纯文字版必须真的没有底色/边框：残留一个 chip 样式就等于没改
  const noChip = await page.evaluate(() => document.querySelectorAll('.mgchip, .mgchips').length === 0);
  if (noChip) ok('逐项已经不再渲染色块 chip');
  else bad('还残留 .mgchip / .mgchips 元素');

  if (meat.more == null) ok('六项齐全时不出现「另 N 项」');
  else bad(`不该有尾注却出现了：${meat.more}`);

  if (cumin.none?.includes('食物库里没有「孜然粉」')) ok(`没匹配上的项如实说明：${cumin.none}`);
  else bad(`孜然粉的说明不对：${cumin.none}`);

  if (cumin.segs?.length === 0) ok('没匹配上的项不补 0（0 项）');
  else bad(`孜然粉不该有矿物质，实际 ${cumin.segs?.length} 项`);

  if (items.every((x) => x.overflow === false)) ok('矿物质那一行没有横向溢出');
  else bad('有卡片的矿物质行超出了容器宽度');

  // ── 六格汇总
  const grid = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) =>
      c.textContent?.includes('这一餐的矿物质'),
    );
    if (!card) return null;
    // 保险丝：`getComputedStyle(null)` 会抛 TypeError，栈里只有一行 evaluate，
    // 看不出是「类名被改了」。这里显式区分「卡片没渲染」和「网格类名失效」。
    // **这类失败不报错、只量错，而绿色报告比红色失败更危险。**
    const mg = card.querySelector('.mgrid6');
    return {
      head: card.querySelector('.title')?.textContent?.replace(/\s+/g, ' ').trim(),
      tiles: [...card.querySelectorAll('.mtile')].map((t) => ({
        label: t.querySelector('.mn')?.textContent ?? '',
        value: t.querySelector('.mv')?.textContent ?? '',
        pct: t.querySelector('.mp')?.textContent ?? '',
        barW: t.querySelector('.bar b')?.style.width ?? '',
        na: t.classList.contains('na'),
      })),
      hint: card.querySelector('.hint')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      gridCols: mg ? getComputedStyle(mg).gridTemplateColumns.split(' ').length : null,
    };
  });

  if (!grid) bad('找不到「这一餐的矿物质」汇总卡');
  else {
    ok('汇总卡已渲染');
    if (grid.gridCols === null) bad('.mgrid6 没找到 —— 三列网格的类名被改了？');

    if (grid.head?.includes('1 / 2 项有数据')) ok(`标题计数正确：${grid.head}`);
    else bad(`标题计数不对：${grid.head}`);

    if (grid.tiles.length === 6) ok('六格齐全');
    else bad(`格子数 ${grid.tiles.length}，期望 6`);

    if (grid.gridCols === 3) ok('三列网格（6 项排成两行）');
    else bad(`网格列数 ${grid.gridCols}，期望 3`);

    const ca = grid.tiles.find((t) => t.label === '钙');
    if (ca?.value === '6mg') ok(`钙格显示 ${ca.value}`);
    else bad(`钙格内容不对：${JSON.stringify(ca)}`);

    if (ca?.pct === '占全天 <1%') ok('6/800 如实写成「<1%」而不是四舍五入成 1%');
    else bad(`钙占比文案不对：${ca?.pct}`);

    const fe = grid.tiles.find((t) => t.label === '铁');
    if (fe?.pct?.startsWith('占全天')) ok(`铁占比：${fe.pct}`);
    else bad(`铁占比缺失：${JSON.stringify(fe)}`);

    if (grid.tiles.every((t) => parseFloat(t.barW || '0') <= 100)) ok('进度条宽度不超过 100%');
    else bad(`有条溢出：${grid.tiles.map((t) => t.barW).join(' ')}`);

    if (grid.hint.includes('下限')) ok(`下限说明存在：${grid.hint}`);
    else bad(`缺少下限说明：${grid.hint}`);

    if (grid.hint.includes('没匹配上库')) ok('因为孜然粉没匹配上，提示里点明了这一点');
    else bad(`没提示有食材未匹配：${grid.hint}`);
  }

  // ── 改克数：矿物质必须跟着变（nutrition 会重算，文字读的是它）
  await page.evaluate(() => {
    const first = document.querySelector('.selitem');
    const plus = [...first.querySelectorAll('.stepper button')].find((b) => b.textContent === '+');
    plus.click();
  });
  await sleep(500);

  const after = await page.evaluate(() => {
    const first = document.querySelector('.selitem');
    const card = [...document.querySelectorAll('.card')].find((c) =>
      c.textContent?.includes('这一餐的矿物质'),
    );
    return {
      grams: first.querySelector('.stepper b')?.textContent ?? '',
      segs: [...first.querySelectorAll('.mtext .mgtext')].map((x) => x.textContent.trim()),
      calcium: [...card.querySelectorAll('.mtile')]
        .find((t) => t.querySelector('.mn')?.textContent === '钙')
        ?.querySelector('.mv')?.textContent ?? '',
    };
  });

  // 100g → 110g：钙 6 → 6.6，钾 305 → 335.5 → 显示 336
  if (after.grams === '110g') ok('点 + 后克数 100g → 110g');
  else bad(`克数没跟着变：${after.grams}`);

  if (after.segs.some((t) => t.includes('钙') && t.includes('6.6'))) ok('单项的钙同步变成 6.6mg');
  else bad(`单项文字没重算：${after.segs.join(' | ')}`);

  if (after.calcium === '6.6mg') ok('汇总的钙同步变成 6.6mg');
  else bad(`汇总没重算：${after.calcium}`);

  if (pageErrors.length === 0) ok('控制台无异常');
  else bad(`页面异常：${pageErrors.slice(0, 2).join(' | ')}`);

  // 加 --shot 时留真机宽度（390）的整页图，排版问题看截图比看断言快。
  // 深浅两版都强制指定：真正生效的 theme 在 IndexedDB 的 settings 里
  // （localStorage 的 app.theme 只是首帧镜像，改它会被下一次 applyTheme 顶回去），
  // 所以不跟着宿主系统的偏好走，否则同一台机器上永远只出一种。
  if (process.argv.includes('--shot')) {
    // .app 是内部滚动容器，fullPage 截不到下面 → 把视口拉高；
    // .tabbar / .hdr 是 fixed/sticky，会把首尾卡片压住，截图前一律藏掉
    await page.setViewport({ width: 390, height: 1500, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    for (const [mode, file] of [
      ['dark', 'tools/.shots/meal-minerals.png'],
      ['light', 'tools/.shots/meal-minerals-light.png'],
    ]) {
      await page.evaluate(async (m) => {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('daily-intake');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const tx = db.transaction('settings', 'readwrite');
        const st = tx.objectStore('settings');
        const row = await new Promise((res, rej) => {
          const g = st.get('app');
          g.onsuccess = () => res(g.result);
          g.onerror = () => rej(g.error);
        });
        row.theme = m;
        st.put(row);
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        db.close();
      }, mode);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.selitem', { timeout: 30_000 });
      await sleep(700);
      await page.evaluate(() => {
        document.querySelectorAll('.tabbar, .hdr').forEach((el) => {
          el.style.display = 'none';
        });
      });
      await page.screenshot({ path: file });
      // 整页缩到聊天窗里那行字只有几个像素，另存一张第一项的放大图用来看细节
      const first = await page.$('.selitem');
      if (first) await first.screenshot({ path: file.replace(/\.png$/, '-zoom.png') });
      console.log(`shot: ${file} theme=${mode}`);
    }
  }
} catch (e) {
  bad(`执行中断：${e.message}`);
} finally {
  await browser.close();
}

console.log('');
for (const m of oks) console.log(`  ✓ ${m}`);
for (const m of fails) console.log(`  ✗ ${m}`);
console.log(`\n${oks.length} 通过 / ${fails.length} 失败\n`);
process.exit(fails.length === 0 ? 0 : 1);
