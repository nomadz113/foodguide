/**
 * 「今日来源 TOP3」真组件渲染 → design/top-sources-a.png
 *
 *   node tools/render-topsrc.mjs
 *
 * 为什么用 ssrLoadModule 渲染真组件，而不是再手抄一份 HTML：
 * 手抄的稿子迟早会和真组件分叉（颜色变量改了稿子不会跟着改）。
 * 这里直接跑 src/ui/TopSources.tsx，输出就代表真机。
 *
 * 浅色 / 深色两版并排：这两版的色值是分别调的，只看一版会漏掉对比度问题。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '..');
const OUT = resolve(ROOT, 'design/top-sources-a.png');

const vite = await createServer({
  root: APP,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const { TopSources } = await vite.ssrLoadModule('/src/ui/TopSources.tsx');
const { computeTopSources } = await vite.ssrLoadModule('/src/core/advice/top.ts');
const { makeItem, makeMeal } = await vite.ssrLoadModule('/src/core/meal/build.ts');
const { facts } = await vite.ssrLoadModule('/src/core/nutrition/types.ts');

/** 示例数据：与设计稿口径一致（总热量 1,940 kcal / 脂肪 65 g） */
function item(name, grams, values, parentDish = null) {
  return makeItem({ name, per100g: facts(values), baseG: grams, grams, parentDish });
}
const meals = [
  makeMeal({
    date: '2026-10-27', slot: 'breakfast',
    items: [
      item('米饭', 300, { kcal: 116, fat: 0.5, protein: 2.6 }),
      item('鸡蛋', 50, { kcal: 144, fat: 10, protein: 6.5 }),
      item('牛奶', 250, { kcal: 54, fat: 3.2, protein: 3 }),
    ],
  }),
  makeMeal({
    date: '2026-10-27', slot: 'lunch',
    items: [
      item('红烧肉', 150, { kcal: 213, fat: 18.7, protein: 15 }),
      item('米饭', 250, { kcal: 116, fat: 0.5, protein: 2.6 }),
      item('西兰花', 200, { kcal: 34, fat: 0.4, protein: 5.6 }),
      item('大豆油', 12, { kcal: 900, fat: 100 }),
    ],
  }),
  makeMeal({
    date: '2026-10-27', slot: 'dinner',
    items: [
      item('牛肉', 120, { kcal: 158, fat: 4.2, protein: 26 }),
      item('面条', 260, { kcal: 138, fat: 0.5, protein: 4.5 }),
      item('豆腐', 100, { kcal: 82, fat: 4.8, protein: 8.1 }),
    ],
  }),
];

const top = computeTopSources(meals);
const html = renderToStaticMarkup(React.createElement(TopSources, { top }));

const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');

/** 建议卡外壳：只包一层定位用，样式全部来自 index.css */
function shell() {
  return `
  <div class="phone">
    <div class="app">
      <div class="hdr"><div><h1>今天</h1><div class="sub">减脂 · 11 餐 · 23 项</div></div></div>
      <div class="main">
        <div class="advice">
          <div class="h"><span>✦</span><span>今天纤维差16克</span><em class="adv-src">AI</em></div>
          ${html}
          <p>只吃了14g纤维，离30g目标差得远。早餐没蔬菜，午餐晚餐里有胡萝卜、白萝卜但量少，绿叶菜完全缺失。</p>
          <ul class="adv-acts">
            <li>加 500g 绿叶菜（约 11g 纤维），剩 5g 分几次用水果和杂豆补，一顿吃不完</li>
          </ul>
          <div class="adv-foot">
            <span class="planline">早餐 444 · 午餐 559 · 晚餐 937</span>
            <button class="adv-btn">换一种说法</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * 主题是作用在 <html> 上的（:root 深色 / :root[data-theme='light'] 浅色），
 * 所以两版必须**分两张文档**渲染 —— 在同一个 html 里塞内层 data-theme 是没用的，
 * 变量取的还是外层那套（踩过一次：深底配浅色变量，数字直接糊掉）。
 */
function doc(theme) {
  const attr = theme === 'light' ? ' data-theme="light"' : '';
  const label = theme === 'light' ? '浅色 · 白底' : '深色 · 跟随系统';
  return `
<!doctype html><html lang="zh-CN"${attr}><head><meta charset="utf-8">
<style>
${css}
body { margin: 0; background: ${theme === 'light' ? '#e9edf4' : '#05070a'}; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.canvas { width: 430px; padding: 22px 24px 20px; }
.chead { margin-bottom: 16px; }
.chead h1 { font-size: 17px; font-weight: 700; margin: 0 0 4px; color: ${theme === 'light' ? '#0f172a' : '#e9eef6'}; }
.chead p { margin: 0; font-size: 11.5px; color: ${theme === 'light' ? '#5b6b80' : '#8d99ab'}; }
.vlabel { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
.vtag { font-size: 11px; font-weight: 700; color: #fff; background: #1d4ed8; border-radius: 6px; padding: 2px 8px; }
.vname { font-size: 13px; font-weight: 650; color: ${theme === 'light' ? '#0f172a' : '#e9eef6'}; }
.phone {
  background: ${theme === 'light' ? '#fff' : '#0b0e13'};
  border: 1px solid ${theme === 'light' ? '#dde3ec' : '#242e3c'};
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 2px 10px ${theme === 'light' ? 'rgba(15,23,42,.07)' : 'rgba(0,0,0,.5)'};
}
.phone .app { height: auto; }
.phone .main { padding: 0 12px 14px; }
.phone .hdr { padding: 12px 12px 8px; }
.phone .hdr h1 { font-size: 18px; }
.phone .advice { margin-top: 0; }
</style></head><body>
<div class="canvas">
  <div class="chead">
    <h1>今日来源 TOP3 —— 变体 A（并入建议卡）</h1>
    <p>真组件渲染（ssrLoadModule 跑 src/ui/TopSources.tsx），非手抄稿</p>
  </div>
  <div class="vlabel"><span class="vtag">${label.split(' · ')[0]}</span><span class="vname">${label.split(' · ')[1]}</span></div>
  ${shell()}
</div>
</body></html>`;
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 430, height: 900, deviceScaleFactor: 2 },
});
const p = await browser.newPage();

mkdirSync(dirname(OUT), { recursive: true });
for (const theme of ['light', 'dark']) {
  const htmlDoc = doc(theme);
  await p.setContent(htmlDoc, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));
  const el = await p.$('.canvas');
  const file = OUT.replace(/\.png$/, `-${theme}.png`);
  await el.screenshot({ path: file });
  console.log('已生成', file);
}

await browser.close();
await vite.close();

console.log('热量榜', JSON.stringify(top.kcal.entries));
console.log('脂肪榜', JSON.stringify(top.fat.entries));
