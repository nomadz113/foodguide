/**
 * 第二轮几何实测：窄屏 320、长文案、热区重叠归属、焦点环、
 * 以及删掉 backdrop-filter 之后底栏会不会透内容。
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const V2 = `
:root{--focus-ring:0 0 0 3px rgba(74,107,36,.26);--shell-bg:rgba(250,245,236,0.97);
  --radius-card:18px;--radius-block:14px;--radius-inset:12px;--radius-ctl:10px;}
.mcell{background:none;border-radius:0;padding:0}
.mcell .dot{width:7px;height:7px;margin-bottom:4px}
.mgrid{gap:8px}
.mcell .lb{font-size:12px}
.mcell .vv{font-size:12px;font-weight:500}
.period-nav button{font-size:12px;min-height:var(--ctl-h);position:relative;padding:6px 9px}
.period-nav button::before{content:'';position:absolute;inset:-4px -6px}
.period-nav span{font-size:12px}
/* 反例：给相邻两个按钮都加 10/8 的 ::before，看重叠区归谁 */
.meal .del,.meal .edit{position:relative;font-size:12px}
.meal .del::before,.meal .edit::before{content:'';position:absolute;inset:-10px -8px}
.field:focus-within{border-color:var(--ok-line);box-shadow:var(--focus-ring)}
.tabbar{backdrop-filter:none;-webkit-backdrop-filter:none}
.src{font-size:12px;font-weight:500;padding:1px 6px;border-radius:999px}
.chip{font-size:12px}
.btn{min-height:44px}
.fold > button{min-height:44px}
.suggest button{min-height:36px;font-size:12px;padding:7px 11px}
.stepper button{width:44px;height:44px}
.tiers3 button{min-height:44px}
.selitem .rm{position:relative;font-size:12px}
.selitem .rm::before{content:'';position:absolute;inset:-13px -10px}
.searchbox{min-height:44px}
.searchbox input{font-size:16px}
`;

const html = (kind) => `
<div class="app">
  <div class="main" id="main">
  ${kind === 'micro' ? `
    <div class="card">
      <div class="title row"><span>微量营养素</span><span>— 表示数据不足</span></div>
      <div class="mgrid" id="mgrid">
        ${[['钙', '464'], ['铁', '3.9'], ['锌', '2.3'], ['硒', '13'], ['钾', '464'], ['镁', '63'], ['纤', '0.58'],
          ['VA', '420'], ['VC', '36'], ['VD', '2.1'], ['VE', '6.4'], ['B1', '0.42'], ['B2', '0.38'], ['烟酸', '7.6']]
          .map(([l, v], i) => `<div class="mcell ${i >= 8 ? 'hit' : ''}"><div class="dot"></div><div class="lb">${l}</div><div class="vv">${v}</div></div>`).join('')}
      </div>
    </div>` : ''}
  ${kind === 'nav' ? `
    <div class="period-nav" id="pnav">
      <button>‹ 前 30 天</button><span id="pnlabel">30 天 · 3/18–4/16</span><button disabled>后 30 天 ›</button>
    </div>
    <div class="period-nav" id="pnav2">
      <button>‹ 前 90 天</button><span>90 天 · 2025/12/18–2026/3/17</span><button disabled>后 90 天 ›</button>
    </div>` : ''}
  ${kind === 'meal' ? `
    <div class="card">
      <div class="meal">
        <div class="thumb">🍚</div>
        <div class="info"><div class="n">番茄炒蛋盖饭 · 无糖豆浆 · 一个卤蛋</div><div class="d">12:40 · 午餐 · 3 项</div></div>
        <div class="kcal"><b>642</b><span>kcal</span></div>
        <button class="edit" id="edit">改</button>
        <button class="del" id="del">×</button>
      </div>
    </div>
    <div class="intentcard">
      <div class="ic-items">
        <div class="ic-item">
          <div class="ic-item-l" id="l1"><b>番茄炒蛋盖饭</b><span class="src ai" id="src1">AI估·库补微量</span></div>
          <span class="ic-item-r">250g · 380 kcal</span>
        </div>
        <div class="ic-item">
          <div class="ic-item-l" id="l2"><b>香菇滑鸡煲仔饭（中份）</b><span class="src ai">AI估·库补微量</span></div>
          <span class="ic-item-r">350g · 612 kcal</span>
        </div>
      </div>
    </div>
    <div class="searchbox"><input id="si" placeholder="搜索食物（如：米饭）"></div>
    <div class="suggest"><button>米饭 150g</button><button>鸡蛋 50g</button><button>牛奶 250ml</button></div>
    <div class="fold"><button id="foldbtn">微量营养素 · 14 项有数据</button></div>
    <div class="selitem"><div class="top"><b>米饭</b><span class="kc">174 kcal</span><button class="rm" id="rm">×</button></div>
      <div class="ctl"><div class="stepper"><button id="sm">−</button><b>150</b><button id="sp">+</button></div></div></div>
    <div class="ic-btns"><button class="btn ghost">取消</button><button class="btn primary">记入今天</button></div>` : ''}
  ${kind === 'tabbar' ? `
    <div class="card"><div class="title">内容</div><div class="hint">滚动到底部时这里的长文本应当被底栏挡住</div></div>
    <div class="card"><div class="title">内容 2</div></div>
    <div class="totalbar"><span class="k">合计</span><b id="tb">642</b></div>` : ''}
  </div>
  ${kind === 'tabbar' ? `<div class="tabbar" id="tbar"><a class="on"><span class="ico">⌂</span>今日</a><a><span class="ico">◔</span>小助手</a>
    <span class="fab"><button>+</button></span><a><span class="ico">▤</span>统计</a><a><span class="ico">◑</span>档案</a></div>` : ''}
</div>`;

const probe = () => {
  const r = (el) => el.getBoundingClientRect();
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const textW = (el) => { const g = document.createRange(); g.selectNodeContents(el); const rs = [...g.getClientRects()]; return rs.length ? Math.max(...rs.map((x) => x.width)) : 0; };
  const lines = (el) => { const rs = [...el.getClientRects()].filter((x) => x.width > 0.5); return rs.length || 1; };
  const o = {};

  const g = q('#mgrid');
  if (g) {
    const cells = qa('#mgrid .mcell');
    o.micro = {
      gridW: +r(g).width.toFixed(1),
      cellW: +r(cells[0]).width.toFixed(1),
      cellH: +r(cells[0]).height.toFixed(1),
      gridH: +r(g).height.toFixed(1),
      niacinLb: +textW(cells[13].querySelector('.lb')).toFixed(1),
      valueMax: +Math.max(...cells.map((c) => textW(c.querySelector('.vv')))).toFixed(1),
      tightest: +Math.min(...cells.map((c) => r(c).width - textW(c.querySelector('.vv')))).toFixed(1),
      anyWrap: cells.some((c) => lines(c.querySelector('.lb')) > 1 || lines(c.querySelector('.vv')) > 1),
      dot: +r(cells[0].querySelector('.dot')).width.toFixed(1),
      rowGap: getComputedStyle(g).rowGap, colGap: getComputedStyle(g).columnGap,
    };
  }

  qa('.period-nav').forEach((nav, i) => {
    const btns = [...nav.querySelectorAll('button')];
    const label = nav.querySelector('span');
    o['nav' + i] = {
      navW: +r(nav).width.toFixed(1),
      overflow: nav.scrollWidth > nav.clientWidth + 0.5,
      scrollW: nav.scrollWidth, clientW: nav.clientWidth,
      btnW: btns.map((b) => +r(b).width.toFixed(1)),
      labelW: +r(label).width.toFixed(1),
      labelH: +r(label).height.toFixed(1),
      labelLines: lines(label),
      // 按钮 ::before 扩出的左/右边界，会不会压到中间那个非可点标签
      beforeBleed: btns.map((b) => {
        const cs = getComputedStyle(b, '::before');
        const inset = cs.content !== 'none' ? cs.inset : null;
        return inset;
      }),
      gap: getComputedStyle(nav).gap,
    };
  });

  const del = q('#del');
  if (del) {
    const ed = q('#edit');
    const a = r(ed); const b = r(del);
    const midX = (a.right + b.left) / 2;
    const hitAt = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; };
    // 两个 ::before 都往外 8px：重叠带 = [b.left-8, a.right+8]
    o.mealTap = {
      editBox: [+a.width.toFixed(1), +a.height.toFixed(1)],
      delBox: [+b.width.toFixed(1), +b.height.toFixed(1)],
      gapBetween: +(b.left - a.right).toFixed(1),
      overlapPx: +(8 + 8 - (b.left - a.right)).toFixed(1),
      hitInMiddleOfGap: hitAt(midX, (a.top + a.bottom) / 2),
      hitAtEditLeftEdge: hitAt(a.left - 6, (a.top + a.bottom) / 2),
      hitAtDelRightEdge: hitAt(b.right + 6, (a.top + a.bottom) / 2),
    };
    const l1 = q('#l1'), l2 = q('#l2');
    o.srcSqueeze = [l1, l2].map((l) => {
      const nm = l.querySelector('b');
      const src = l.querySelector('.src');
      return {
        rowText: nm.textContent,
        rowW: +r(l).width.toFixed(1),
        nameBoxW: +r(nm).width.toFixed(1),
        nameTextW: +textW(nm).toFixed(1),
        clipped: nm.scrollWidth > nm.clientWidth + 0.5,
        srcW: +r(src).width.toFixed(1),
        rowH: +r(l.closest('.ic-item')).height.toFixed(1),
      };
    });
    o.taps = {};
    for (const [sel, el] of [['del', q('#del')], ['edit', q('#edit')], ['rm', q('#rm')],
      ['stepper', q('#sm')], ['suggest', q('.suggest button')], ['btn', q('.btn')],
      ['fold', q('#foldbtn')], ['search', q('.searchbox')], ['tiersbtn', q('.tiers3 button')]]) {
      if (!el) continue;
      const bx = r(el);
      o.taps[sel] = {
        w: +bx.width.toFixed(1), h: +bx.height.toFixed(1),
        before: getComputedStyle(el, '::before').content !== 'none',
      };
    }
  }

  const f = q('#field');
  if (f) {
    q('#field input').focus();
    o.focus = {
      shadow: getComputedStyle(f).boxShadow,
      docScrollW: document.scrollingElement.scrollWidth,
      viewW: window.innerWidth,
      hScroll: document.scrollingElement.scrollWidth > window.innerWidth,
      activeTag: document.activeElement?.tagName,
      fieldOverflow: getComputedStyle(f).overflow,
      inputOutline: getComputedStyle(document.activeElement).outlineStyle,
    };
  }

  const tb = q('#tbar');
  if (tb) {
    const cs = getComputedStyle(tb);
    o.tabbar = {
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      bg: cs.backgroundColor,
      borderTopW: cs.borderTopWidth,
      shellVar: getComputedStyle(document.documentElement).getPropertyValue('--shell-bg').trim(),
      h: +r(tb).height.toFixed(1),
    };
  }
  return o;
};

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--hide-scrollbars'] });
const out = {};
for (const width of [320, 360, 390]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 780, deviceScaleFactor: 2 });
  for (const mode of ['base', 'v2']) {
    for (const kind of ['micro', 'nav', 'meal', 'tabbar']) {
      if (kind === 'tabbar' && mode === 'base') continue;
      await page.setContent(
        `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8">
         <style>${css}</style>${mode === 'v2' ? `<style>${V2}</style>` : ''}</head>
         <body>${html(kind)}</body></html>`, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 50));
      out[`${width}-${mode}-${kind}`] = await page.evaluate(probe);
    }
  }
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
