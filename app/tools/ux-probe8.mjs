/**
 * 给视觉/前端的三条「补丁」先自己验一遍，别把没量过的 CSS 交出去。
 *
 *   P1 `.adv-btn` min-height 36 → var(--tap-min)：建议卡底行会不会变高到挤掉 planline
 *   P2 `.searchbox input` 42 → 44：搜索框 +2px 之后有没有把下面的行挤出去
 *   P3 `.ptabs button::before` 底部 -6 → -7：热区 43.2 → 44.2，会不会盖住下面的分区内容
 *   P4 `.meal .edit/.del` 只向外侧扩 2px：热区 44×44，中间 6px 是否仍然全程中性
 *
 * 用法：node tools/ux-probe8.mjs
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

const PATCH = {
  advice: `.adv-btn{min-height:var(--tap-min);}`,
  search: `.searchbox input{min-height:var(--tap-min);}`,
  ptabs: `.ptabs button{position:relative;} .ptabs button::before{content:'';position:absolute;inset:-5px -8px -7px;}`,
  meal: `.meal .edit,.meal .del{position:relative}
       .meal .edit::before{content:'';position:absolute;inset:-2px 0 -2px -2px;}
       .meal .del::before{content:'';position:absolute;inset:-2px -2px -2px 0;}`,
};

const HTML = {
  advice: `<div class="app"><div class="main"><div class="card">
      <div class="advice"><div class="h">还可摄入 1426 kcal，但蛋白还差 103g</div>
        <p>优先用高蛋白低热量的组合补齐：一顿补不完，剩下几餐各加一份蛋白（150g 鸡肉 / 200g 豆腐 / 2 个鸡蛋）。</p>
        <div class="adv-foot"><div class="planline">晚餐 476</div><button class="adv-btn" id="ab" disabled>生成建议</button></div>
      </div></div></div></div>`,
  search: `<div class="app"><div class="main"><div class="card">
      <div class="searchbox" id="sb"><input id="si" placeholder="搜食物，如「鸡蛋」" /></div>
      <div class="pickrow"><div class="pk"><b>鸡蛋</b><span class="sub">库</span></div><div class="kc">143 kcal</div></div>
      <div class="pickrow"><div class="pk"><b>番茄炒蛋</b><span class="sub">自建</span></div><div class="kc">642 kcal</div></div>
    </div></div></div>`,
  ptabs: `<div class="app"><div class="main"><div class="card">
      <div class="ptabs" id="pt"><button class="on">饮食</button><button>体重</button><button>血压</button></div>
      <div class="chart-bars"><i style="height:40%"></i><i style="height:70%"></i><i style="height:55%"></i></div>
      </div></div></div>`,
  meal: `<div class="app"><div class="main"><div class="card"><div class="title">今日记录</div>
      <div class="meal"><div class="thumb">🍚</div>
        <div class="info"><div class="n">番茄炒蛋盖饭 + 一杯豆浆</div><div class="d">午餐 · 12:40</div></div>
        <div class="kcal"><b>642</b><span>kcal</span></div>
        <button class="edit" id="e">改</button><button class="del" id="d">×</button>
      </div></div></div></div>`,
};

const MEASURE = {
  advice: () => {
    const f = document.querySelector('.adv-foot').getBoundingClientRect();
    const b = document.getElementById('ab').getBoundingClientRect();
    const p = document.querySelector('.planline').getBoundingClientRect();
    const card = document.querySelector('.card').getBoundingClientRect();
    return {
      按钮: `${+b.width.toFixed(1)}×${+b.height.toFixed(1)}`,
      底行高: +f.height.toFixed(1),
      planline行数: Math.round(p.height / 17.4),
      卡片高: +card.height.toFixed(1),
      文字溢出行: document.querySelectorAll('.advice p').length,
    };
  },
  search: () => {
    const s = document.getElementById('sb').getBoundingClientRect();
    const i = document.getElementById('si').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.pickrow')].map((r) => +r.getBoundingClientRect().height.toFixed(1));
    return { 搜索框外框: +s.height.toFixed(1), input击区: +i.height.toFixed(1), 行高: rows, 总高: +document.querySelector('.card').getBoundingClientRect().height.toFixed(1) };
  },
  ptabs: () => {
    const b = document.querySelector('.ptabs button').getBoundingClientRect();
    const bars = document.querySelector('.chart-bars').getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.ptabs button'), '::before');
    const t = Math.abs(parseFloat(cs.top)), bo = Math.abs(parseFloat(cs.bottom));
    const l = Math.abs(parseFloat(cs.left)), r = Math.abs(parseFloat(cs.right));
    return {
      按钮: `${+b.width.toFixed(1)}×${+b.height.toFixed(1)}`,
      热区: `${+(b.width + l + r).toFixed(1)}×${+(b.height + t + bo).toFixed(1)}`,
      热区底到图表顶: +(bars.top - (b.bottom + bo)).toFixed(1),
    };
  },
  meal: () => {
    const e = document.getElementById('e').getBoundingClientRect();
    const d = document.getElementById('d').getBoundingClientRect();
    const gap = d.left - e.right;
    const y = e.top + e.height / 2;
    const hits = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const el = document.elementFromPoint(e.right + gap * t, y);
      hits.push(el ? el.id || el.className.split(' ')[0] : null);
    }
    // 外侧扩张是否生效：取各伪元素的四边 inset，再在实盒外 1.5px 处取样
    const ins = (el) => {
      const cs = getComputedStyle(el, '::before');
      if (!cs.content || cs.content === 'none') return null;
      return { t: parseFloat(cs.top), r: parseFloat(cs.right), b: parseFloat(cs.bottom), l: parseFloat(cs.left) };
    };
    const ie = ins(document.getElementById('e'));
    const id = ins(document.getElementById('d'));
    const at = (x, yy) => {
      const el = document.elementFromPoint(x, yy);
      return el ? el.id || el.className.split(' ')[0] : null;
    };
    return {
      实盒: `${e.width}×${e.height}`,
      间隙: +gap.toFixed(1),
      伪元素_edit: ie && `${ie.t}/${ie.r}/${ie.b}/${ie.l}`,
      伪元素_del: id && `${id.t}/${id.r}/${id.b}/${id.l}`,
      热区: ie && id ? `${+(e.width - ie.l - ie.r).toFixed(0)}×${+(e.height - ie.t - ie.b).toFixed(0)}／${+(d.width - id.l - id.r).toFixed(0)}×${+(d.height - id.t - id.b).toFixed(0)}` : '无',
      左外1_5px: at(e.left - 1.5, y),
      右外1_5px: at(d.right + 1.5, y),
      上外1_5px: at(e.left + e.width / 2, e.top - 1.5),
      下外1_5px: at(e.left + e.width / 2, e.bottom + 1.5),
      间隙取样: hits.join(','),
    };
  },
};

const run = async (width, which, patch) => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 3 });
  await page.setContent(
    `<!doctype html><meta charset=utf-8><style>${css}</style><style>body{margin:0;background:var(--bg)}</style>` +
    (patch ? `<style>${PATCH[which]}</style>` : '') + HTML[which],
    { waitUntil: 'load' },
  );
  const r = await page.evaluate(`(${MEASURE[which].toString()})()`);
  await browser.close();
  return r;
};

for (const [which, label] of [['advice', 'P1 .adv-btn 36→44'], ['search', 'P2 .searchbox input 42→44'], ['ptabs', 'P3 .ptabs 热区底 -6→-7'], ['meal', 'P4 .edit/.del 外侧扩 2px']]) {
  console.log(`\n=== ${label} ===`);
  for (const w of [320, 360, 390]) {
    const a = await run(w, which, false);
    const b = await run(w, which, true);
    console.log(`${w}px 改前 ${JSON.stringify(a)}`);
    console.log(`${w}px 改后 ${JSON.stringify(b)}`);
  }
}
