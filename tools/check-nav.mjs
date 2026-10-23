/** 导航实测：每个页面里 tabbar 是否存在、是否在视口内、点「今日」能不能回去 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const BASE = 'http://localhost:4173';
const OUT = resolve(import.meta.dirname, '../../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' });
await wait(600);

const routes = ['/', '/stats', '/profile', '/chat', '/capture', '/add', '/settings'];

for (const r of routes) {
  await page.goto(`${BASE}/#${r}`, { waitUntil: 'networkidle2' });
  await wait(700);

  const info = await page.evaluate(() => {
    const bar = document.querySelector('.tabbar');
    if (!bar) return { hasBar: false };
    const rect = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2);
    return {
      hasBar: true,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      viewportH: window.innerHeight,
      visible: rect.top < window.innerHeight && rect.bottom > 0,
      // 中心点实际命中的元素，用来发现"被遮住"
      hitTag: hit ? `${hit.tagName}.${(hit.className || '').toString().split(' ')[0]}` : null,
      scrollH: document.documentElement.scrollHeight,
    };
  });

  let navBack = null;
  // 先截图再点导航，否则截到的全是点完之后的目标页
  await page.screenshot({ path: resolve(OUT, `nav-check${r.replace(/\//g, '-') || '-root'}.png`) });

  if (info.hasBar) {
    // 点「今日」
    const ok = await page.evaluate(() => {
      const a = [...document.querySelectorAll('.tabbar a')].find((x) => x.textContent.includes('今日'));
      if (!a) return false;
      a.click();
      return true;
    });
    await wait(500);
    navBack = ok ? await page.evaluate(() => location.hash) : 'no-link';
  }

  console.log(`${r.padEnd(10)} bar=${info.hasBar} visible=${info.visible ?? '-'} top=${info.top ?? '-'} hit=${info.hitTag ?? '-'} → 点今日后 hash=${navBack}`);
}

await browser.close();
