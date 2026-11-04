/** 第四轮：设置页/缺口页/分段控件等剩余热区。 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const V2 = `
.chip{font-size:12px;font-weight:500}
.seg button{font-size:12px}
.mpact .mpill{font-size:12px}
.rowbtn{font-size:12px}
.theme-seg button{font-size:12px}
.alert{font-size:12px}
.hint{font-size:12px}
.statusrow{font-size:12px}
`;

const body = `
<div class="app"><div class="main">
  <div class="card">
    <div class="title">设置</div>
    <button class="rowbtn" id="r1"><span class="k">每天开始时间</span><span class="v">凌晨 4:00</span></button>
    <button class="rowbtn" id="r2"><span class="k">健康数据授权</span><span class="v">去授权 ›</span></button>
    <div class="seg" style="width:100%" id="seg"><button class="on" id="segA">周</button><button id="segB">月</button><button id="segC">季</button></div>
    <div class="theme-seg" id="ts"><button class="on" id="t1"><span class="pv pv-sys"><i></i><i></i></span>跟随系统</button>
      <button id="t2"><span class="pv pv-light"><i></i><i></i></span>浅色</button>
      <button id="t3"><span class="pv pv-dark"><i></i><i></i></span>深色</button></div>
    <div class="alert"><span class="ic">!</span><span>这里有 12px 后可能换行的一条提示文字。</span></div>
  </div>
  <div class="misscard">
    <div class="mhead"><span class="mname">香菇滑鸡煲仔饭</span><span class="mcount">3 次</span></div>
    <div class="mmeta">最近 1 月 · 未匹配</div>
    <div class="mact"><button class="mpill primary" id="mp1">加入食物库</button><button class="mpill" id="mp2" disabled>忽略</button></div>
  </div>
  <div class="card">
    <div class="title">外观</div>
  </div>
</div>
<div class="tabbar" id="tbar"><a class="on"><span class="ico">⌂</span>今日</a><a><span class="ico">◔</span>小助手</a>
  <span class="fab"><button>+</button></span><a><span class="ico">▤</span>统计</a><a><span class="ico">◑</span>档案</a></div>
</div>`;

const probe = () => {
  const q = (s) => document.querySelector(s);
  const r = (el) => el.getBoundingClientRect();
  const o = {};
  const put = (k, el) => { if (!el) return; const b = r(el); o[k] = { w: +b.width.toFixed(1), h: +b.height.toFixed(1), font: getComputedStyle(el).fontSize }; };
  put('rowbtn', q('#r1')); put('rowbtn2', q('#r2'));
  put('segBtn', q('#segA')); put('themeBtn', q('#t1'));
  put('mpill', q('#mp1')); put('mpillDisabled', q('#mp2'));
  put('tabbarA', q('.tabbar a'));
  o.alert = (() => { const a = q('.alert'); return { h: +r(a).height.toFixed(1), lines: a.getClientRects().length }; })();
  return o;
};

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--hide-scrollbars'] });
const out = {};
for (const mode of ['base', 'v2']) {
  const p = await browser.newPage();
  await p.setViewport({ width: 360, height: 760, deviceScaleFactor: 2 });
  await p.setContent(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>${css}</style>${mode === 'v2' ? `<style>${V2}</style>` : ''}</head><body>${body}</body></html>`, { waitUntil: 'load' });
  await new Promise((r2) => setTimeout(r2, 50));
  out[mode] = await p.evaluate(probe);
  await p.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
