/**
 * 导航闭环测试：每个入口进去以后必须有路回来。
 *
 * 用户报的 bug 是「小助手/统计/档案进去以后无法返回」——根因不是按钮坏了，
 * 而是这三个页面有的压根没挂底部导航（/chat 在 Shell 外面），
 * 在 PWA 全屏（没有浏览器 UI）下等于把用户关进了死胡同。
 *
 * 这个脚本用真实点击验证四条退路：
 *   1. 底部 tabbar 能切回今日
 *   2. 「+」直接进拍照页，不再经过中间的手动记账页
 *   3. 拍照页的「取消」能回今日
 *   4. 系统返回（history.back）能回上一页
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 160)));

const hash = () => page.evaluate(() => location.hash);
const tapTab = async (label) => {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.tabbar a, .tabbar .fab button')]
      .find((x) => x.textContent.includes(t));
    el?.click();
  }, label);
  await wait(450);
};
const tapText = async (text) => {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    if (!el) return false;
    el.click();
    return true;
  }, text);
  await wait(450);
  return ok;
};

const results = [];
const check = (name, got, want) => {
  const ok = got === want;
  results.push({ name, ok, got, want });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${got}${ok ? '' : `  (期望 ${want})`}`);
};

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
await wait(700);

// 1) FAB 直接进拍照页
await tapTab('+');
check('点「+」进拍照页', await hash(), '#/capture');

// 2) 拍照页「取消」回今日
await tapText('取消');
check('拍照页取消回今日', await hash(), '#/');

// 3) 三个主页面都能点回今日
for (const [label, expectPath] of [['小助手', '#/chat'], ['统计', '#/stats'], ['档案', '#/profile']]) {
  await tapTab(label);
  check(`点「${label}」进入`, await hash(), expectPath);
  await tapTab('今日');
  check(`从「${label}」点今日返回`, await hash(), '#/');
}

// 4) 系统返回键
await tapTab('统计');
await page.goBack();
await wait(450);
check('系统返回从统计回今日', await hash(), '#/');

// 5) 设置页（从档案进）能用「返回」回到档案
await tapTab('档案');
await page.evaluate(() => {
  [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('设置'))?.click();
});
await wait(500);
const settingsHash = await hash();
await tapText('返回');
check(`设置页返回（进来时 ${settingsHash}）`, await hash(), '#/profile');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (errors.length) console.log('页面错误：', errors.slice(0, 3));
if (failed.length) process.exitCode = 1;

await browser.close();
