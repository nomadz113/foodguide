/**
 * 血压统计页的区块顺序守卫。
 *
 * 顺序是纯排版，单测覆盖不到，截图又要靠人眼比对 —— 这里直接读 DOM：
 * 每个 `.card` 取前几个字当签名，断言先后关系。
 * 以后谁再挪卡片，这条会立刻报出来，不用等用户说「怎么又变回去了」。
 *
 * 用法：node tools/check-bp-order.mjs http://127.0.0.1:4173/
 */
import puppeteer from 'puppeteer-core';

const TARGET = process.argv[2] ?? 'http://127.0.0.1:4173/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const fails = [];
const oks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

page.on('pageerror', (e) => fails.push(`页面异常：${e.message}`));

async function goto(hash) {
  await page.goto(`${TARGET}#${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.app', { timeout: 60_000 });
  await sleep(900);
}

/** 手填一条：收缩压 / 舒张压 / 脉搏，保存后回统计页 */
async function addReading(sys, dia, pulse) {
  await goto('/bp/manual');
  await page.waitForSelector('input[aria-label="收缩压"]', { timeout: 20_000 });
  await page.click('input[aria-label="收缩压"]');
  await page.type('input[aria-label="收缩压"]', String(sys));
  await page.click('input[aria-label="舒张压"]');
  await page.type('input[aria-label="舒张压"]', String(dia));
  if (pulse) {
    await page.click('input[aria-label="脉搏"]');
    await page.type('input[aria-label="脉搏"]', String(pulse));
  }
  // 保存按钮在吸底条里
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '保存');
    b?.click();
  });
  // 保存后会 replace 到统计页；等列表条数变化不可靠，直接等 URL
  await page.waitForFunction(() => location.hash.includes('/stats'), { timeout: 20_000 });
  await sleep(600);
}

await addReading(118, 76, 72);
await addReading(115, 74, 70);
await addReading(121, 79, 74);

await goto('/stats?tab=bp');
await page.waitForSelector('.main .card', { timeout: 20_000 });
await sleep(600);

/** 每个卡片的签名：取标题首个中文片段 */
const cards = await page.evaluate(() =>
  [...document.querySelectorAll('.main .card')].map((c) => {
    const t = (c.querySelector('.title span')?.textContent || c.innerText || '').trim();
    return t.slice(0, 8).replace(/\s+/g, ' ');
  }),
);

const idx = (kw) => cards.findIndex((t) => t.includes(kw));
const chart = idx('平均');
const period = idx('这段时间');
const peak = idx('晨峰');
// 「最近一次」没有标题，签名是日期文字，抓「脉压差」更稳
const latest = await page.evaluate(() =>
  [...document.querySelectorAll('.main .card')].findIndex((c) => c.innerText.includes('脉压差')),
);

if (chart === 0) oks.push(`① 趋势图在最上面（${cards[0]}）`);
else fails.push(`趋势图不在第一位：${JSON.stringify(cards)}`);

if (latest > chart && latest !== -1) oks.push(`② 今日血压紧跟趋势图（第 ${latest + 1} 块）`);
else fails.push(`今日血压位置不对（index=${latest}）`);

if (peak > latest && peak !== -1) oks.push(`③ 晨峰/晚峰在今日血压下面（第 ${peak + 1} 块）`);
else fails.push(`晨峰/晚峰位置不对（index=${peak}）`);

if (period > latest && period < peak) oks.push('④ 这段时间夹在两者之间，统计块保持相邻');
else fails.push(`这段时间位置不对（index=${period}）`);

console.log('卡片顺序：', cards.map((t, i) => `${i}:${t}`).join(' | '));
await page.screenshot({ path: 'tools/_bp-order.png', fullPage: true });

for (const o of oks) console.log('  ✓', o);
for (const f of fails) console.log('  ✗', f);
console.log(fails.length === 0 ? `\n通过 ${oks.length} 项` : `\n失败 ${fails.length} 项`);

await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
