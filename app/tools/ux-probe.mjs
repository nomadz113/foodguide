/**
 * V2 规范「会不会把界面弄坏」的几何实测。
 *
 * 不改产品代码：把 index.css 原样注入，再用一份 V2 覆盖表（--v2 时追加）
 * 重新量同一批盒子的宽高、折行、溢出与热区。
 *
 * 只回答三个问题：
 * 1. 12px 字号抬升后，某个盒子还放不放得下（scrollWidth / 行盒数量）；
 * 2. 去底色后的微量 14 格在 360/390 下每格多宽、标签会不会折行；
 * 3. 可点元素的真实命中矩形（getBoundingClientRect），有没有小于 44×44。
 *
 * 用法：node tools/ux-probe.mjs [--json]
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => { try { readFileSync(p, { flag: 'r' }); return true; } catch { return false; } });

/** V2 里会影响几何的那些条目（颜色不测，已由 check-palette 复算） */
const V2 = `
:root{
  --radius-card:18px; --radius-block:14px; --radius-inset:12px; --radius-ctl:10px; --radius-pill:999px;
}
/* 5.1.4 微量 14 格去底色：只留 5px 点 + 12px 标签 + 12px 数值 */
.mcell{background:none;border-radius:0;padding:0}
.mgrid{gap:8px}
.mcell .lb{font-size:12px}
.mcell .vv{font-size:12px;font-weight:500}
/* 5.3.5 日号、5.3.3 柱内数字 */
.chart-lbs span{font-size:12px}
.cval{font-size:12px;font-weight:500;letter-spacing:-0.01em}
/* 4.4 标签抬到 12px */
.src{font-size:12px;font-weight:500;padding:1px 6px;border-radius:999px}
.badge{font-size:12px;font-weight:500;padding:2px 8px;border-radius:999px}
.chip{font-size:12px;font-weight:500;padding:2.5px 8px}
.macro3 span{font-size:12px}
.mtile .mn{font-size:12px}
.mtile .mp{font-size:12px}
.advice .planline{font-size:12px}
.alert{font-size:12px}
.big span{font-size:12px}
.hdr .sub{font-size:12px}
.ring-center .unit{font-size:12px}
.pill{font-size:12px}
.totalbar .k{font-size:12px}
.mtext{font-size:12px}
.mtext b small{font-size:12px}
.mgmore{font-size:12px}
.flabel{font-size:12px}
.krow .v small{font-size:12px}
/* 5.4.2 焦点环 */
.field:focus-within{border-color:var(--ok-line);box-shadow:var(--focus-ring)}
/* 5.2.5 / 5.5.5 禁用态补描边 */
.btn-save:disabled,.wnext:disabled,.btn:disabled{border:1px solid var(--line);opacity:1}
.btn-save:disabled{background:var(--card2);color:var(--mute)}
.wnext:disabled{background:var(--card2);color:var(--mute)}
.btn:disabled{background:var(--card2);color:var(--dis-fg)}
/* 5.3.2 周期按钮热区 */
.period-nav button{font-size:12px;min-height:var(--ctl-h);position:relative;padding:6px 9px}
.period-nav button::before{content:'';position:absolute;inset:-4px -6px}
/* 5.1.1 环心与合计条 */
.ring-center .big{font-size:34px;font-weight:500;letter-spacing:-0.02em}
/* 反面清单 4：禁用态不许压 opacity */
.adv-btn:disabled,.mpill:disabled{opacity:1;border-color:var(--line);color:var(--dis-fg);background:var(--card2)}
`;

/** 与真实组件同构的标记：字符串都在 TSX 里能对上 */
const BODY = (kind) => `
<div class="app" style="width:100%">
  <div class="hdr"><div><h1>今天</h1><div class="sub">减脂 · 1 餐 · 3 项</div></div>
    <span class="pill ok">剩 1426 kcal</span></div>
  <div class="main" id="main">

    ${kind === 'today' ? `
    <div class="card">
      <div class="title row"><span>微量营养素</span><span>— 表示数据不足</span></div>
      <div class="mgrid" id="mgrid">
        ${[['钙', '464'], ['铁', '3.9'], ['锌', '2.3'], ['硒', '13'], ['钾', '464'], ['镁', '63'], ['纤', '0.58'],
          ['VA', '—'], ['VC', '—'], ['VD', '—'], ['VE', '0.12'], ['B1', '0.21'], ['B2', '0.38'], ['烟酸', '7.6']]
          .map(([l, v], i) => `<div class="mcell ${i === 13 ? 'hit' : ''}"><div class="dot"></div><div class="lb">${l}</div><div class="vv">${v}</div></div>`).join('')}
      </div>
      <div class="hint" style="text-align:left">维生素矿物质取自食物成分表；复合菜按配料折算，误差约 ±20%。</div>
    </div>

    <div class="card">
      <div class="title">今日记录</div>
      <div class="meal">
        <div class="thumb">🍚</div>
        <div class="info"><div class="n">番茄炒蛋盖饭 + 一杯豆浆</div><div class="d">午餐 · 12:40</div></div>
        <div class="kcal"><b>642</b><span>kcal</span></div>
        <button class="edit" id="meal-edit">改</button>
        <button class="del" id="meal-del">×</button>
      </div>
    </div>

    <div class="card">
      <div class="title">宏量</div>
      <div class="macro3">
        <div><span>蛋白质</span><b>28 g</b></div>
        <div><span>脂肪</span><b>17 g</b></div>
        <div><span>碳水</span><b>54 g</b></div>
      </div>
      <div class="krow"><span class="k">BMI</span><span class="v">24.3<span class="badge over" style="margin-left:8px">偏高</span></span></div>
    </div>

    <div class="advice">
      <div class="h">还可摄入 1426 kcal，但蛋白还差 103g</div>
      <p>优先用高蛋白低热量的组合补齐：一顿补不完，剩下几餐各加一份蛋白（150g 鸡肉 / 200g 豆腐 / 2 个鸡蛋）。</p>
      <div class="adv-foot"><div class="planline">晚餐 476</div><button class="adv-btn" id="adv" disabled>生成建议</button></div>
    </div>
    ` : ''}

    ${kind === 'stats' ? `
    <div class="stathd" style="padding:10px 16px 0">
      <div class="stathd-row">
        <div class="ptabs" role="group">
          <button class="on" id="ptab1">饮食</button><button id="ptab2">血压</button>
        </div>
        <div class="seg" style="width:132px"><button class="on" id="seg1">周</button><button id="seg2">月</button><button id="seg3">季</button></div>
      </div>
      <div class="stathd-sub">近 7 天 · 记录 1 天</div>
    </div>
    <div class="card">
      <div class="title row"><span>每日热量</span><span style="font-size:10px">虚线为目标 1,902</span></div>
      <div class="period-nav" id="pnav">
        <button id="pnav-prev">‹ 前 7 天</button><span>近 7 天</span><button id="pnav-next" disabled>后 7 天 ›</button>
      </div>
      <div class="chart-bars${kind === 'stats' ? '' : ' dense'}" id="bars">
        ${Array.from({ length: 7 }, (_, i) => `<div class="ccol"><div class="cbar-slot"><div class="cbar" style="height:${20 + i * 10}%"><span class="cval">${1200 + i * 123}</span></div></div></div>`).join('')}
      </div>
      <div class="chart-lbs" id="lbs7">${['一', '二', '三', '四', '五', '六', '日'].map((d) => `<span>${d}</span>`).join('')}</div>
    </div>
    <div class="card">
      <div class="title row"><span>每日热量</span><span style="font-size:10px">虚线为目标 1,902</span></div>
      <div class="chart-bars dense" id="bars-dense">
        ${Array.from({ length: 30 }, (_, i) => `<div class="ccol"><div class="cbar-slot"><div class="cbar" style="height:${30 + (i % 5) * 10}%"></div></div></div>`).join('')}
      </div>
      <div class="chart-lbs dense" id="lbs30">
        ${Array.from({ length: 30 }, (_, i) => { const day = 5 + i; const lab = (29 - i) % 5 === 0 ? String(day) : ''; return `<span class="${i === 29 ? 'today' : ''}">${lab}</span>`; }).join('')}
      </div>
      <div class="hint">30 天窗口（dense）</div>
    </div>
    ` : ''}

    ${kind === 'capture' ? `
    <div class="intentcard">
      <div class="ic-head"><div><div class="ic-title">今天 · 午餐</div><div class="ic-sub">3 项 · 共 642 kcal</div></div>
        <span class="chip g">记一餐</span></div>
      <div class="ic-items">
        <div class="ic-item" id="icitem">
          <div class="ic-item-l" id="iciteml"><b>番茄炒蛋盖饭</b><span class="src ai" id="src">AI估·库补微量</span></div>
          <span class="ic-item-r">250g · 380 kcal</span>
        </div>
        <div class="ic-item">
          <div class="ic-item-l"><b>无糖豆浆</b><span class="src custom">自制</span></div>
          <span class="ic-item-r">300g · 96 kcal</span>
        </div>
      </div>
      <div class="ic-btns"><button class="btn ghost" id="btn1">取消</button><button class="btn primary" id="btn2" disabled>记入今天</button></div>
    </div>

    <div class="fold"><button id="foldbtn">微量营养素 · 14 项有数据 <span class="chev">⌄</span></button></div>

    <div class="attr-card">
      <div class="attr-row"><span class="attr-lbl">吃了</span><div class="tiers3"><button>全部</button><button class="on">一半</button><button>少量</button></div></div>
    </div>

    <div class="selitem">
      <div class="top"><b>番茄炒蛋盖饭</b><span class="kc">380 kcal</span><button class="rm" id="rm">×</button></div>
      <div class="ctl"><div class="stepper"><button id="stepminus">−</button><b>250</b><button id="stepplus">+</button></div></div>
    </div>

    <div class="searchbox"><input placeholder="搜索食物（如：米饭）" id="searchinput"></div>
    <div class="suggest"><button id="sug1">米饭 150g</button><button id="sug2">鸡蛋 50g</button></div>

    <div class="totalbar tb-capture">
      <div class="tb-left"><div class="tb-l1"><b>642</b><span>kcal</span></div><div class="tb-l2">蛋白 28 / 131 g</div></div>
      <button class="btn-save" id="save" disabled>保存</button>
    </div>
    ` : ''}

    ${kind === 'welcome' ? `
    <div class="welcome">
      <div class="whead"><div class="wstep"><span class="on"></span><span class="done"></span><span></span></div>
        <div class="wcount">第 1 步 / 共 3 步</div><h1>先认识一下你</h1>
        <div class="wsub">这三步只问最基本的几件事，算出的目标随时能改。</div></div>
      <div class="wbody">
        <div class="grid"><label class="field" id="field1"><span>身高 cm</span><input value="172" id="winput1"></label></div>
        <div class="grid"><label class="field" id="field2"><span>体重 kg</span><input value="78.0" id="winput2"></label></div>
        <div class="wsum"><div class="wsum-k">你的每日目标</div>
          <div class="wsum-v">1,902<small>kcal</small></div>
          <div class="wsum-n">按减脂 0.5kg/周 推算</div>
          <div class="wsum-split"><div><span>基础代谢 BMR</span><b>1,743<i>kcal</i></b></div><div><span>每日总消耗 TDEE</span><b>2,402<i>kcal</i></b></div></div></div>
      </div>
      <div class="wfoot"><button class="wback" id="wback">上一步</button><button class="wnext" id="wnext" disabled>下一步</button></div>
    </div>
    ` : ''}
  </div>
  <div class="tabbar"><a class="on"><span class="ico">⌂</span>今日</a><a><span class="ico">◔</span>小助手</a>
    <span class="fab"><button id="fab">+</button></span><a><span class="ico">▤</span>统计</a><a><span class="ico">◑</span>档案</a></div>
</div>`;

const measure = () => {
  const r = (el) => el.getBoundingClientRect();
  const out = {};
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];

  /** 行盒数量：> 1 表示折行了（对中文标签来说就是「顶高」） */
  const lines = (el) => {
    if (!el) return 0;
    const rects = [...el.getClientRects()].filter((x) => x.width > 0.5);
    return rects.length || 1;
  };
  const textW = (el) => {
    if (!el) return 0;
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()];
    return rects.length ? Math.max(...rects.map((x) => x.width)) : 0;
  };

  // ── 微量 14 格 ──
  const grid = q('#mgrid');
  if (grid) {
    const cells = qa('#mgrid .mcell');
    const first = cells[0];
    const niacin = cells[13];
    out.mgrid = {
      gridW: +r(grid).width.toFixed(1),
      gap: getComputedStyle(grid).gap,
      cellW: +r(first).width.toFixed(1),
      cellH: +r(first).height.toFixed(1),
      rows: [...new Set(cells.map((c) => Math.round(r(c).top)))].length,
      gridH: +r(grid).height.toFixed(1),
      // 「烟酸」两字标签在 12px 下的真实文本宽
      niacinLbW: +textW(niacin.querySelector('.lb')).toFixed(1),
      niacinLbLines: lines(niacin.querySelector('.lb')),
      maxLbW: +Math.max(...cells.map((c) => textW(c.querySelector('.lb')))).toFixed(1),
      anyLbWrap: cells.some((c) => lines(c.querySelector('.lb')) > 1),
      anyVvWrap: cells.some((c) => lines(c.querySelector('.vv')) > 1),
      cellWTight: cells.map((c) => +(r(c).width - textW(c.querySelector('.vv'))).toFixed(1)),
      dotBox: (() => { const d = first.querySelector('.dot'); const cs = getComputedStyle(d); return { w: r(d).width, shadow: cs.boxShadow }; })(),
      bg: getComputedStyle(first).backgroundColor,
      radius: getComputedStyle(first).borderRadius,
    };
  }

  // ── 7 列 / 30 列日号 ──
  const mklbs = (sel) => {
    const spans = qa(`${sel} span`);
    if (!spans.length) return null;
    const ws = spans.map((s) => +r(s).width.toFixed(2));
    const tw = spans.map((s) => +textW(s).toFixed(1));
    // 相邻两个「有字」的列之间，文字盒会不会真的压到一起
    let overlap = 0;
    let worst = null;
    for (let i = 0; i < spans.length; i++) {
      if (!tw[i]) continue;
      const ci = r(spans[i]).left + r(spans[i]).width / 2;
      const l = ci - tw[i] / 2;
      const rr = ci + tw[i] / 2;
      for (let j = i + 1; j < spans.length; j++) {
        if (!tw[j]) continue;
        const cj = r(spans[j]).left + r(spans[j]).width / 2;
        const l2 = cj - tw[j] / 2;
        const o = Math.min(rr, l2 + tw[j]) - Math.max(l, l2);
        if (o > overlap) { overlap = o; worst = [i, j]; }
      }
    }
    return {
      n: spans.length,
      colW: ws[0],
      rowH: +r(spans[0]).height.toFixed(1),
      textW: tw.filter(Boolean),
      maxTextW: Math.max(...tw.filter(Boolean), 0),
      overflowPx: +(Math.max(...tw.filter(Boolean), 0) - ws[0]).toFixed(1),
      labeledCount: tw.filter(Boolean).length,
      pairOverlapPx: +overlap.toFixed(1),
      worstPair: worst,
      overflowStyle: getComputedStyle(spans[0]).overflow,
    };
  };
  out.lbs7 = mklbs('#lbs7');
  out.lbs30 = mklbs('#lbs30');

  // ── 柱内数字 ──
  const cval = q('#bars .cval');
  if (cval) {
    const bar = cval.parentElement;
    out.cval = {
      textW: +textW(cval).toFixed(1),
      barW: +r(bar).width.toFixed(1),
      slotW: +r(bar.closest('.ccol')).width.toFixed(1),
      barH: +r(bar).height.toFixed(1),
      cvalLineH: +r(cval).height.toFixed(1),
      overflowsBar: +(textW(cval) - r(bar).width).toFixed(1),
      fontSize: getComputedStyle(cval).fontSize,
    };
  }

  // ── 来源标签 vs 菜名 ──
  const iteml = q('#iciteml');
  if (iteml) {
    const b = iteml.querySelector('b');
    const src = q('#src');
    const row = q('#icitem');
    out.src = {
      rowW: +r(row).width.toFixed(1),
      nameBoxW: +r(b).width.toFixed(1),
      nameTextW: +textW(b).toFixed(1),
      nameClipped: b.scrollWidth > b.clientWidth + 0.5,
      srcW: +r(src).width.toFixed(1),
      srcTextW: +textW(src).toFixed(1),
      srcH: +r(src).height.toFixed(1),
      rightW: +r(row.querySelector('.ic-item-r')).width.toFixed(1),
      rowH: +r(row).height.toFixed(1),
      srcFont: getComputedStyle(src).fontSize,
    };
  }

  // ── 三列小格 / 徽章 / 提示条 ──
  const m3 = q('.macro3 div');
  if (m3) out.macro3 = { colW: +r(m3).width.toFixed(1), spanW: +textW(m3.querySelector('span')).toFixed(1), spanLines: lines(m3.querySelector('span')), h: +r(m3).height.toFixed(1) };
  const badge = q('.badge');
  if (badge) out.badge = { w: +r(badge).width.toFixed(1), h: +r(badge).height.toFixed(1), textW: +textW(badge).toFixed(1), font: getComputedStyle(badge).fontSize };
  const pl = q('.planline');
  if (pl) out.planline = { w: +r(pl).width.toFixed(1), h: +r(pl).height.toFixed(1), lines: lines(pl) };
  const chip = q('.chip');
  if (chip) out.chip = { w: +r(chip).width.toFixed(1), h: +r(chip).height.toFixed(1) };

  // ── 热区 ──
  const taps = {};
  const TARGETS = [
    ['#meal-del', '.meal .del'], ['#meal-edit', '.meal .edit'],
    ['#ptab1', '.ptabs button'], ['#seg1', '.seg button'],
    ['#pnav-prev', '.period-nav button'], ['#pnav-next', '.period-nav button'],
    ['#rm', '.selitem .rm'], ['#stepminus', '.stepper button'], ['#stepplus', '.stepper button'],
    ['#sug1', '.suggest button'], ['#sug2', '.suggest button'],
    ['#btn1', '.btn'], ['#adv', '.adv-btn'], ['#foldbtn', '.fold > button'],
    ['#save', '.btn-save'], ['#wback', '.wback'], ['#wnext', '.wnext'],
    ['#fab', '.tabbar .fab button'], ['.tabbar a', '.tabbar a'],
    ['.tiers3 button', '.tiers3 button'], ['#searchinput', '.searchbox input'],
  ];
  for (const [sel, label] of TARGETS) {
    const el = q(sel);
    if (!el) continue;
    const b = r(el);
    // ::before 撑出来的实际命中区（如果规范这么做了）
    const cs = getComputedStyle(el, '::before');
    const dz = cs.content !== 'none' ? cs.inset || cs.top : null;
    const padTop = parseFloat(dz) || 0;
    taps[label] = {
      w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      hasBefore: dz != null,
      beforeInset: dz,
      font: getComputedStyle(el).fontSize,
    };
  }
  out.taps = taps;

  // ptabs 两个 ::before 是否互相压到（重叠处点击归 DOM 里靠后的那个）
  const tabs = qa('.ptabs button, .period-nav button');
  if (tabs.length >= 2) {
    const boxes = tabs.map((t) => {
      const b = r(t);
      const cs = getComputedStyle(t, '::before');
      const top = cs.content !== 'none' ? parseFloat(cs.top) || 0 : 0;
      const left = top !== 0 ? parseFloat(cs.left || cs.right) || 0 : 0;
      return { l: b.left + left, rr: b.right - left, t: b.top + top, b2: b.bottom - top, grow: top !== 0 };
    });
    out.pseudoOverlap = boxes.some((x) => x.grow) ? {
      // 只关心同一行里相邻的两个
      sameRow: boxes.every((x) => Math.abs(x.t - boxes[0].t) < 2),
      gapPx: boxes.length > 1 ? +(boxes[1].l - boxes[0].rr).toFixed(1) : null,
    } : null;
  }

  // ── 焦点环是否撑出横向滚动 ──
  const inp = q('#winput1');
  if (inp) {
    inp.focus();
    const de = document.scrollingElement;
    const fieldBox = r(q('#field1'));
    out.focusRing = {
      docScrollW: de.scrollWidth,
      viewW: window.innerWidth,
      horizontalScroll: de.scrollWidth > window.innerWidth,
      fieldRight: +fieldBox.right.toFixed(1),
      shadow: getComputedStyle(q('#field1')).boxShadow,
      fieldMarginRight: +(window.innerWidth - fieldBox.right).toFixed(1),
    };
    inp.blur();
  }

  // ── 底栏是否透出内容 ──
  const tb = q('.tabbar');
  if (tb) {
    const cs = getComputedStyle(tb);
    const shell = getComputedStyle(document.documentElement).getPropertyValue('--shell-bg').trim();
    out.tabbar = {
      bg: cs.backgroundColor,
      shellBgVar: shell,
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      borderTop: cs.borderTopWidth + ' ' + cs.borderTopStyle,
      h: +r(tb).height.toFixed(1),
    };
  }

  // ── 详情：字号最小值 / 字重最大值（本轮 CSS 全量） ──
  const all = [...document.querySelectorAll('body *')];
  let minFs = 99; let minFsSel = ''; let maxFw = 0; let maxFwSel = '';
  const smallText = [];
  for (const el of all) {
    if (!el.textContent || !el.textContent.trim()) continue;
    if (el.children.length && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < minFs) { minFs = fs; minFsSel = el.className || el.tagName; }
    if (fs < 12) smallText.push(`${el.className || el.tagName}:${fs}`);
    const fw = parseInt(cs.fontWeight, 10) || 400;
    if (fw > maxFw) { maxFw = fw; maxFwSel = el.className || el.tagName; }
  }
  out.typography = { minFontSize: minFs, minFontSel: String(minFsSel).slice(0, 40), maxFontWeight: maxFw, maxFwSel: String(maxFwSel).slice(0, 40), underTwelve: [...new Set(smallText)].slice(0, 12) };

  return out;
};

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--hide-scrollbars'] });
const results = {};

for (const width of [360, 390]) {
  for (const mode of ['base', 'v2']) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 800, deviceScaleFactor: 2 });
    for (const kind of ['today', 'stats', 'capture', 'welcome']) {
      await page.setContent(
        `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8">
         <style>${css}</style>${mode === 'v2' ? `<style>${V2}</style>` : ''}</head>
         <body>${BODY(kind)}</body></html>`,
        { waitUntil: 'load' },
      );
      await new Promise((r) => setTimeout(r, 60));
      const m = await page.evaluate(measure);
      results[`${width}-${mode}-${kind}`] = m;
    }
    await page.close();
  }
}

await browser.close();
console.log(JSON.stringify(results, null, 1));
