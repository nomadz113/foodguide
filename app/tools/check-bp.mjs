/**
 * 血压功能端到端冒烟。
 *
 * 单测能证明 guard/engine 算得对，证明不了「表真的建起来了、点保存真的落库了」。
 * 这里用真实浏览器把链路走一遍：手动录入 → 落库 → 首页读到 → 主页列表出现。
 *
 * 刻意**不测拍照**：那需要摄像头和 API Key，而且每次都花钱。
 * 拍照链路唯一独有的是 recogniseBp，它的输入（模型 JSON）由 bpPrompt 的单测覆盖。
 *
 * 用法：node tools/check-bp.mjs http://127.0.0.1:4173/
 */
import puppeteer from 'puppeteer-core';

const TARGET = process.argv[2] ?? 'http://127.0.0.1:4173/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const bad = (m) => fails.push(m);

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

// 托管站（WorkBuddy ?sharecode）对 HTML 之外的子资源也要凭证，
// 而浏览器取 manifest.webmanifest 时不会带上查询串 → 固定 403。
// 这是部署环境的特性，不是 App 的缺陷，不算错误。只在 appears 时放行。
const NOISE = [/manifest\.webmanifest/i, /status of 403/i];
const realErrors = () => consoleErrors.filter((e) => !NOISE.some((re) => re.test(e)));

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function text() {
  return page.evaluate(() => document.body.innerText || '');
}

async function goto(hash) {
  await page.goto(`${TARGET}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.app', { timeout: 60_000 });
  await sleep(1200);
}

/** 血压并进「统计」之后，它的地址是 /stats?tab=bp。判据跟着改，否则全是假失败 */
const isBpView = (u = '') => u.includes('#/stats') && u.includes('tab=bp');

async function heading() {
  return page.evaluate(() => document.querySelector('.hdr h1')?.textContent ?? '');
}

async function tabUrl() {
  return page.evaluate(() => location.hash);
}

try {
  // ① 今日页：空状态应显示血压卡
  await goto('/');
  let t = await text();
  if (t.includes('血压') && t.includes('还没有血压记录')) ok('今日页血压卡 · 空状态');
  else bad(`今日页血压卡缺失（页面文字片段：${t.slice(0, 120)}）`);
  // 零记录时晨晚卡整张不渲染：上面那张卡已经说过「还没有血压记录」，再来一张空卡只是重复
  if (!t.includes(`近 14 天`)) ok('零记录时首页不渲染晨晚卡');
  else bad('零记录却渲染了晨晚卡');

  // ② 手动录入页：三个数字框必须存在且非空图片也能用
  await goto('/bp/manual');
  const inputs = await page.$$('input[type="number"]');
  if (inputs.length >= 2) ok(`手动录入：${inputs.length} 个数字输入框`);
  else bad(`手动录入缺少数字输入框（只有 ${inputs.length} 个）`);

  // NumInput 是非受控组件，必须用真实输入事件而不是直接改 value
  await inputs[0].click();
  await inputs[0].type('126');
  await inputs[1].click();
  await inputs[1].type('82');
  if (inputs[2]) {
    await inputs[2].click();
    await inputs[2].type('74');
  }

  t = await text();
  if (t.includes('正常')) ok('实时分级：126/82 判为「正常」');
  else bad(`分级没有出现（页面片段：${t.slice(0, 200)}）`);

  // ③ 保存 → 应落到「统计 · 血压」分区
  await page.click('.sheetbar button.primary');
  await sleep(1500);
  const url = page.url();
  if (isBpView(url)) ok('保存后落到统计页的血压分区');
  else bad(`保存后停在了 ${url}`);

  t = await text();
  if (t.includes('126/82')) ok('主页读到刚才那条 126/82');
  else bad(`主页没显示 126/82（片段：${t.slice(0, 200)}）`);
  if (t.includes('74')) ok('脉搏一并入库');
  else bad('脉搏没有入库');
  if (t.includes('你自己改过')) ok('时间来源标注为「user」');
  else bad('时间来源没有标成 user');
  // 来源不能因为是拍照页就一律写成 photo —— 手动入口进来的必须是 manual
  if (t.includes('手动录入')) ok('来源标为「手动录入」');
  else bad('来源没有标成手动录入');

  // ③b 心律不齐标记：这道题由用户拍板，选了「有」必须跟着记录走到列表里
  await goto('/bp/manual');
  t = await text();
  if (t.includes('屏幕上有心律不齐提示')) ok('确认卡上有心律不齐三态');
  else bad('确认卡缺心律不齐选择');
  const ihbBtn = await page.$('button[aria-label="心律不齐：有"]');
  if (!ihbBtn) bad('没有找到「有」按钮');
  else {
    await ihbBtn.click();
    await sleep(200);
    const inputsA = await page.$$('input[type="number"]');
    await inputsA[0].click();
    await inputsA[0].type('138');
    await inputsA[1].click();
    await inputsA[1].type('88');
    await page.click('.sheetbar button.primary');
    await sleep(1500);
    await goto('/stats?tab=bp');
    const t2 = await text();
    if (t2.includes('心律不齐标记')) ok('标记随记录进入列表');
    else bad('心律不齐标记没有落到列表');
    if (t2.includes('138/88')) ok('第二条 138/88 入库');
    else bad('138/88 没有入库');
  }

  // ③c 档案页血压入口
  await goto('/profile');
  t = await text();
  if (t.includes('血压记录')) ok('档案页有血压入口');
  else bad('档案页缺血压入口');
  const entry = await page.$('button[aria-label="血压记录"]');
  if (!entry) bad('档案页血压入口不可点击');
  else {
    await entry.click();
    await sleep(1200);
    if (isBpView(page.url())) ok('档案页入口跳到统计·血压分区');
    else bad(`档案页入口跳到了 ${page.url()}`);
  }

  // ③c2 分区切换：饮食 / 血压是同一栏目的两块，默认落在饮食
  await goto('/stats');
  let th = await heading();
  if (th === '进度') ok('统计页默认分区是饮食（标题「进度」）');
  else bad(`统计页默认标题是「${th}」`);

  const tabs = await page.$$('.subtabs button');
  if (tabs.length === 2) ok('分区切换有两个按钮');
  else bad(`分区按钮数量不对（${tabs.length} 个）`);

  if (tabs[1]) {
    await tabs[1].click();
    await sleep(700);
    if ((await tabUrl()).includes('tab=bp')) ok('点「血压」后 URL 带上 tab=bp');
    else bad(`分区没写进 URL（${await tabUrl()}）`);
    th = await heading();
    if (th === '血压') ok('血压分区标题是「血压」');
    else bad(`血压分区标题是「${th}」`);

    // 分区切换不能把周月季那排挤走或改数量
    const segCount = await page.evaluate(() =>
      document.querySelectorAll('.hdr .seg button').length);
    if (segCount === 3) ok('分区切换后周月季仍是三档');
    else bad(`周月季变成 ${segCount} 档`);

    const dietTab = (await page.$$('.subtabs button'))[0];
    await dietTab.click();
    await sleep(700);
    const back = await tabUrl();
    if (back === '#/stats') ok('切回饮食后 URL 回到干净的 /stats');
    else bad(`切回饮食后 URL 是 ${back}`);
  }

  // ③c3 旧地址 /bp 必须还能用：老书签与安卓「最近任务」里都还指着它
  await goto('/bp');
  if (isBpView(page.url())) ok('旧地址 /bp 重定向到统计·血压');
  else bad(`/bp 没有重定向（${page.url()}）`);

  // 底栏「统计」在血压分区下仍要高亮，否则用户会以为不在这个栏目里
  const onTab = await page.evaluate(() =>
    document.querySelector('.tabbar a.on')?.textContent?.includes('统计') ?? false);
  if (onTab) ok('血压分区下底栏「统计」仍选中');
  else bad('血压分区下底栏没有高亮「统计」');

  // ③d P3：周期窗口 / 趋势图 / 概览 / 晨晚对比
  await goto('/stats?tab=bp');
  let tb = await text();
  const segs = await page.$$('.hdr .seg button');
  if (segs.length === 3) ok('周期切换三档（周/月/季）');
  else bad(`周期切换不是三档（找到 ${segs.length} 个）`);

  const chart = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label="血压趋势"]');
    if (!svg) return null;
    return {
      circles: svg.querySelectorAll('circle').length,
      lines: svg.querySelectorAll('polyline').length,
      targets: svg.querySelectorAll('line').length,
    };
  });
  if (chart && chart.circles >= 2 && chart.lines >= 2) {
    ok(`趋势图有点有线（${chart.circles} 点 / ${chart.lines} 段）`);
  } else bad(`趋势图图元不全：${JSON.stringify(chart)}`);
  if (chart && chart.targets >= 1) ok('达标虚线画在图上');
  else bad('图上没有达标虚线');

  if (tb.includes('达标天数')) ok('概览：达标天数');
  else bad('概览缺达标天数');
  if (tb.includes('晨峰 / 晚峰')) ok('晨晚对比区块存在');
  else bad('缺晨晚对比区块');
  // 只有两条记录时不能给出「你的血压夜间更高」这种没有依据的结论
  if (tb.includes('样本还不够')) ok('样本不足时不下晨晚结论');
  else bad('样本不足却给了晨晚结论');

  const navState = await page.evaluate(() =>
    [...document.querySelectorAll('.period-nav button')].map((b) => b.disabled));
  if (navState.length === 2 && navState[1] === true) ok('截至今天时「后」按钮禁用');
  else bad(`周期翻页按钮状态不对：${JSON.stringify(navState)}`);

  // 切档之后图必须重画，而且是按新窗口的天数（周=7 列）
  if (segs[0]) {
    await segs[0].click();
    await sleep(900);
    const weekChart = await page.evaluate(() =>
      document.querySelectorAll('svg[aria-label="血压趋势"] circle').length);
    if (weekChart >= 2) ok(`切到「周」后图重建（${weekChart} 个数据点）`);
    else bad(`切档后图没重画（${weekChart} 个点）`);
    const wl = await text();
    if (wl.includes('近 7 天')) ok('周期标签显示「近 7 天」');
    else bad(`周期标签不对（片段：${wl.slice(0, 120)}）`);
  }

  // ④ 回到今日页：血压卡显示"最近一次"。
  //    此刻有两条同分钟记录 —— datetime-local 只到分钟，measuredAt 完全相同，
  //    胜负必须落在 createdAt 上（否则由随机主键决定，用户会遇到"刚记的不见了"）。
  await goto('/');
  t = await text();
  if (t.includes('138/88')) ok('今日页血压卡显示最近一次（同分钟两条里取后写的那条）');
  else bad(`今日页血压卡没跟进最近一次（片段：${t.slice(0, 200)}）`);
  // 有记录之后晨晚卡才出现；两条记录都在「其它时段」，所以它必须说样本不够
  if (t.includes('近 14 天')) ok('有记录后首页出现晨晚卡');
  else bad('有记录但首页没有晨晚卡');

  // ⑤ 越界读数必须被拦下（不能只是好看的提示）
  await goto('/bp/manual');
  const inputs2 = await page.$$('input[type="number"]');
  await inputs2[0].click();
  await inputs2[0].type('85');
  await inputs2[1].click();
  await inputs2[1].type('132');
  await sleep(300);
  await page.click('.sheetbar button.primary');
  await sleep(900);
  const url2 = page.url();
  t = await text();
  if (url2.includes('/bp/manual') && t.includes('读反了')) ok('132/85 填反 → 拦下并要求核对');
  else bad(`倒置读数没有被拦（url=${url2}）`);

  // ⑥ 清理测试数据，别把 126/82 留在数据库里影响下一步真机试用
  await goto('/stats?tab=bp');
  const del = await page.$$('.meal .del');
  for (const b of del) {
    page.once('dialog', async (d) => d.accept());
    await b.click();
    await sleep(400);
  }
  // 最后一条是刚或无

  const errs = realErrors();
  if (errs.length === 0) ok('全程零 JS 错误');
  else bad(`控制台报错：${errs.slice(0, 3).join(' | ')}`);
} catch (e) {
  bad(`脚本异常：${e.message}`);
} finally {
  await browser.close();
}

console.log('\n=== 血压冒烟 ===');
for (const o of oks) console.log('  ✓', o);
for (const f of fails) console.log('  ✗', f);
console.log(fails.length === 0 ? '\nPASS' : `\nFAIL (${fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
