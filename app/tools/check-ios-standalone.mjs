/**
 * iOS「加到主屏」分支的自检。
 *
 * 为什么需要：主屏模式下的差异（顶部安全区、导出走分享面板）在安卓和桌面浏览器里
 * **一条都触发不到**，改错了也不会有人发现 —— 只有 iPhone 上才会暴露。
 * 这里用无头浏览器把 `navigator.standalone` 打桩成 true，验证代码确实走了那条分支。
 *
 * 注意它验不了真正的 `env(safe-area-inset-top)`：Chromium 没有刘海，env 恒为 0。
 * 能验的是「类加上了、规则命中了」；数值对不对只能真机看。
 *
 *   node tools/check-ios-standalone.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const TARGET = process.argv[2] || 'https://daily-intake.app.workbuddy.host/?sharecode=S7TQGVBK2V';
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

async function probe(label, standalone) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  if (standalone) {
    // 必须在页面脚本之前打桩：main.tsx 是在模块顶层读这个值的
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
    });
  }
  // 不能用 networkidle2 等：SW 装了之后后台还在预缓存 chunk，"网络空闲"可能永远不来
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.hdr', { timeout: 30_000 });

  const r = await page.evaluate(() => {
    const app = document.querySelector('.app');
    const cs = app ? getComputedStyle(app) : null;
    return {
      htmlClass: document.documentElement.className || '(空)',
      paddingTop: cs?.paddingTop ?? null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(label, JSON.stringify(r));
  await page.close();
  return r;
}

const tab = await probe('Safari 标签页 ', false);
const home = await probe('iOS 主屏模式', true);

await browser.close();

const added = home.htmlClass.includes('ios-standalone');
const kept = !tab.htmlClass.includes('ios-standalone');
console.log(`\n主屏模式加类: ${added ? '✓' : '✗'}   普通标签页不加类: ${kept ? '✓' : '✗'}`);
console.log(added && kept ? '结果: PASS' : '结果: FAIL');
process.exit(added && kept ? 0 : 1);
