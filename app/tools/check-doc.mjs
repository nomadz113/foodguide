/**
 * 校验开发方案.html：新增章节的渲染与排版。
 *
 * 只截指定章节，不整页长图 —— 整页几千像素高，看不清细节。
 * 重点看三件事：表格有没有溢出、代码块有没有横向撑破、中文字体有没有缺字。
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..', '..');
const HTML = resolve(ROOT, '开发方案.html');
const OUT = resolve(ROOT, 'design');

const page_html = readFileSync(HTML, 'utf8');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 2 },
});

const p = await browser.newPage();
await p.setContent(page_html, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 500));

// 目录条目数量（侧栏 + 移动抽屉）
const toc = await p.evaluate(() => ({
  nav: document.querySelectorAll('#tocNav a').length,
  sheet: document.querySelectorAll('#tocSheetNav a').length,
  h2: document.querySelectorAll('main h2').length,
  h3: document.querySelectorAll('main h3').length,
  tables: document.querySelectorAll('main table').length,
  wrapped: document.querySelectorAll('main .table-scroll').length,
  // 溢出任一容器的表格
  overflow: [...document.querySelectorAll('main table')].filter(
    (t) => t.getBoundingClientRect().right > window.innerWidth + 1,
  ).length,
}));
console.log('目录条目:', toc);

// 新增章节的标题清单
const heads = await p.evaluate(() =>
  [...document.querySelectorAll('main h2, main h3')]
    .map((h) => h.textContent.trim())
    .filter((t) => /^(10B|12B|12C|12D)/.test(t)),
);
console.log('新增章节:', heads);

// 逐个截图
mkdirSync(OUT, { recursive: true });
const targets = ['10B.', '12B.', '12C.', '12D.'];
for (const t of targets) {
  const h = await p.evaluateHandle((key) => {
    return [...document.querySelectorAll('main h2')].find((x) => x.textContent.trim().startsWith(key));
  }, t);
  const el = h.asElement();
  if (!el) {
    console.log('未找到', t);
    continue;
  }
  // 从该 h2 起，往后收集到下一个 h2 之前的内容
  const box = await p.evaluate((key) => {
    const hs = [...document.querySelectorAll('main h2')];
    const i = hs.findIndex((x) => x.textContent.trim().startsWith(key));
    const end = hs[i + 1];
    const from = hs[i].getBoundingClientRect().top + window.scrollY;
    const to = end ? end.getBoundingClientRect().top + window.scrollY : from + 2000;
    return { from, to };
  }, t);
  const h2 = await el.boundingBox();
  const height = Math.min(box.to - box.from, 3200);
  await p.screenshot({
    path: resolve(OUT, `doc-${t.replace(/\./g, '')}.png`),
    clip: { x: h2.x, y: box.from, width: h2.width, height },
  });
  console.log('已截图', t, Math.round(height), 'px');
}

await browser.close();
