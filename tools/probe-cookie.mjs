/**
 * 查清「确定访问」这一步到底把放行标记记在哪。
 *
 * 这决定 APK 的用户体验：
 *   - 若落 HttpOnly cookie → WebView 的 CookieManager 会持久化，点一次永久不再弹
 *   - 若只是服务端按 IP 记账 → 换网络（WiFi↔蜂窝）就会重新弹
 *
 * page.cookies() 能拿到 HttpOnly，所以能看到 document.cookie 看不到的东西。
 */
import puppeteer from 'puppeteer-core';

const URL_ARG = process.argv[2] || 'https://nomadz-d7gjjkkjleb118f55-1513689063.tcloudbaseapp.com/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 12; V2049A Build/SP1A.210812.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  defaultViewport: { width: 393, height: 851, isMobile: true, hasTouch: true },
  protocolTimeout: 120000,
});
const page = await browser.newPage();
await page.setUserAgent(WEBVIEW_UA);

const setCookies = [];
const notFound = [];
page.on('response', async (r) => {
  const u = r.url();
  if (r.status() >= 400) notFound.push(`${r.status()} ${u}`);
  const h = r.headers();
  const sc = h['set-cookie'];
  if (sc) setCookies.push({ url: u.split('?')[0], setCookie: sc.replace(/\s+/g, ' ').slice(0, 200) });
});

await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(2500);
const noticeShown = await page.evaluate(() => (document.body.innerText || '').includes('页面访问提示'));

let clicked = false;
for (let i = 0; i < 10; i++) {
  const s = await page.evaluate(() => {
    const b = document.querySelector('.redirect-page__operate-submit');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { disabled: b.disabled, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (s && !s.disabled) { await page.mouse.click(s.x, s.y); clicked = true; break; }
  await sleep(1000);
}
await sleep(5000);

// 全部 cookie（含 HttpOnly / Secure），这是 WebView CookieManager 真正会落盘的东西
const allCookies = await page.cookies();

await browser.close();

console.log(
  JSON.stringify(
    {
      noticeShown,
      clicked,
      setCookieHeaders: setCookies.slice(0, 10),
      cookiesInJar: allCookies.map((c) => ({
        name: c.name,
        domain: c.domain,
        httpOnly: c.httpOnly,
        secure: c.secure,
        expires: c.session ? 'session(关掉就没)' : new Date(c.expires * 1000).toISOString().slice(0, 10),
      })),
      notFound: [...new Set(notFound)].slice(0, 10),
    },
    null,
    2
  )
);
