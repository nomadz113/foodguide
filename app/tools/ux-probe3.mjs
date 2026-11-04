/** 第三轮：焦点环、真实周期标签、totalbar+tabbar 相邻去边框、微小字号清单。 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const V2 = `
:root{--focus-ring:0 0 0 3px rgba(74,107,36,.26);--shell-bg:rgba(250,245,236,0.97);--composer-bg:rgba(250,245,236,0.98)}
.field:focus-within{border-color:var(--ok-line);box-shadow:var(--focus-ring)}
.field input:focus-visible{outline:none}
.period-nav button{font-size:12px;min-height:36px;position:relative;padding:6px 9px}
.period-nav button::before{content:'';position:absolute;inset:-4px -6px}
.period-nav span{font-size:12px}
.tabbar{backdrop-filter:none;-webkit-backdrop-filter:none}
`;

const page1 = (label) => `
<div class="app">
  <div class="main">
    <div class="grid"><label class="field" id="f1"><span>身高 cm</span><input id="i1" value="175"></label>
      <label class="field" id="f2"><span>体重 kg</span><input id="i2" value="78"></label></div>
    <div class="period-nav" id="pn"><button>‹ 前 90 天</button><span id="pl">${label}</span><button disabled>后 90 天 ›</button></div>
    <div class="period-nav" id="pn2"><button>‹ 前 30 天</button><span id="pl2">${label}</span><button disabled>后 30 天 ›</button></div>
    <div class="card"><div class="title">尾部</div></div>
  </div>
  <div class="totalbar"><span class="k">合计</span><b>642</b></div>
  <div class="tabbar" id="tbar"><a class="on">今日</a><a>统计</a></div>
  <div class="composer" id="cp"><div class="inputrow"><textarea></textarea><button class="send">发送</button></div></div>
  <div class="tabbar" id="tbar2"><a>今日</a></div>
</div>`;

const probe = () => {
  const q = (s) => document.querySelector(s);
  const r = (el) => el.getBoundingClientRect();
  const textW = (el) => { const g = document.createRange(); g.selectNodeContents(el); const rs = [...g.getClientRects()]; return rs.length ? Math.max(...rs.map((x) => x.width)) : 0; };
  const lines = (el) => [...el.getClientRects()].filter((x) => x.width > 0.5).length || 1;
  const o = {};

  const out = {};
  for (const sel of ['#pl', '#pl2']) {
    const el = q(sel);
    if (!el) continue;
    out[sel] = { w: +r(el).width.toFixed(1), textW: +textW(el).toFixed(1), h: +r(el).height.toFixed(1), lines: lines(el) };
  }
  o.labels = out;
  o.navOverflow = ['#pn', '#pn2'].map((s) => {
    const n = q(s);
    return { scrollW: n.scrollWidth, clientW: n.clientWidth };
  });

  q('#i1').focus();
  o.focus = {
    docScrollW: document.scrollingElement.scrollWidth,
    viewW: window.innerWidth,
    hScroll: document.scrollingElement.scrollWidth > window.innerWidth,
    ring: getComputedStyle(q('#f1')).boxShadow,
    fieldRight: +r(q('#f1')).right.toFixed(1),
    active: document.activeElement?.id,
    outline: getComputedStyle(document.activeElement).outlineStyle,
    fieldOverflow: getComputedStyle(q('#f1')).overflow,
  };

  o.borders = {
    totalbarPlusTabbar: getComputedStyle(q('#tbar')).borderTopWidth,
    composerPlusTabbar: getComputedStyle(q('#tbar2')).borderTopWidth,
    tabbarBg: getComputedStyle(q('#tbar')).backgroundColor,
    backdrop: getComputedStyle(q('#tbar')).backdropFilter || getComputedStyle(q('#tbar')).webkitBackdropFilter,
  };
  return o;
};

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--hide-scrollbars'] });
const res = {};
for (const width of [320, 360, 390]) {
  const p = await browser.newPage();
  await p.setViewport({ width, height: 760, deviceScaleFactor: 2 });
  for (const mode of ['base', 'v2']) {
    for (const label of ['90 天 · 12/18–3/17', '365 天 · 1/1–12/31']) {
      await p.setContent(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>${css}</style>${mode === 'v2' ? `<style>${V2}</style>` : ''}</head><body>${page1(label)}</body></html>`, { waitUntil: 'load' });
      await new Promise((r2) => setTimeout(r2, 40));
      const key = `${width}-${mode}-${label.includes('365') ? 'long' : 'quarter'}`;
      res[key] = await p.evaluate(probe);
    }
  }
  await p.close();
}
await browser.close();
console.log(JSON.stringify(res, null, 1));
