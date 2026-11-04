/**
 * 「改 / ×」两个 40×40 能不能到 44，以及到了之后热区归谁 —— 用实测判，不靠注释里的断言。
 *
 * 争议点曾是 index.css 的一句注释：「扩到 44 会互相压住，::before 重叠时归 DOM 靠后的
 * 那个，会把『改』变成『删』」。结论只在**单侧扩 ≥ gap÷2** 时成立，而间隙实测 6px，
 * 所以 `-2px` 到 `-4px` 都不可能重叠。这个脚本把三件事钉死：
 *
 *   1. 两个实盒的真实间隙；
 *   2. 加 `::before` 后热区的四边尺寸、热区之间还剩多少、是否重叠；
 *   3. 在「间隙里」和「实盒外侧」逐点取样 `elementFromPoint`，确认
 *      中间那条间隙仍然中性、外侧确实能点中。
 *
 * 两种注入各跑一遍：对称扩（`inset:-2px`，旧注释担心的写法）与只向外侧扩（现用写法）。
 *
 * 判据（脚本末尾会断言，失败 exit 1）：
 *   · 热区 ≥ 44×44；
 *   · 相邻热区不重叠（hotGap ≥ 0）；
 *   · 间隙里的取样序列与「不加 ::before」时完全一致（间隙保持中性）。
 *
 * 用法：node tools/ux-probe7.mjs
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

const BODY = `<div class="app" style="width:100%"><div class="main">
  <div class="card"><div class="title">今日记录</div>
    <div class="meal">
      <div class="thumb">🍚</div>
      <div class="info"><div class="n">番茄炒蛋盖饭 + 一杯豆浆</div><div class="d">午餐 · 12:40</div></div>
      <div class="kcal"><b>642</b><span>kcal</span></div>
      <button class="edit" id="e">改</button>
      <button class="del" id="d">×</button>
    </div>
  </div></div></div>`;

/** 只覆盖成 40×40 的实盒（屏蔽产品里已有的 -4px），再按变体注入 */
const BASE = `
.meal .edit, .meal .del { position: relative; }
.meal .edit::before, .meal .del::before { content: none; }
`;
const VARIANTS = {
  对称扩2px: `.meal .edit::before,.meal .del::before{content:'';position:absolute;inset:-2px}`,
  只向外侧4px: `.meal .edit::before{content:'';position:absolute;inset:-2px 0 -2px -4px}
              .meal .del::before{content:'';position:absolute;inset:-2px -4px -2px 0}`,
};

const run = async (width, variant) => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height: 800, deviceScaleFactor: 3 });
  const extra = variant ? `<style>${BASE}${VARIANTS[variant]}</style>` : `<style>${BASE}</style>`;
  await page.setContent(
    `<!doctype html><meta charset=utf-8><style>${css}</style><style>body{margin:0;background:var(--bg)}</style>${extra}${BODY}`,
    { waitUntil: 'load' },
  );
  const r = await page.evaluate(() => {
    const e = document.getElementById('e');
    const d = document.getElementById('d');
    const re = e.getBoundingClientRect();
    const rd = d.getBoundingClientRect();
    const gap = rd.left - re.right;

    /** 按四边 inset 各算各的（对称假设在现用写法上会算错） */
    const hot = (el, rect) => {
      const cs = getComputedStyle(el, '::before');
      const live = cs.content && cs.content !== 'none' && cs.display !== 'none';
      const n = (v) => (live ? Math.abs(parseFloat(v) || 0) : 0);
      const t = n(cs.top), rr = n(cs.right), b = n(cs.bottom), l = n(cs.left);
      return {
        left: rect.left - l, right: rect.right + rr,
        top: rect.top - t, bottom: rect.bottom + b,
        w: rect.width + l + rr, h: rect.height + t + b,
        inset: live ? `${cs.top}/${cs.right}/${cs.bottom}/${cs.left}` : '无',
      };
    };
    const he = hot(e, re), hd = hot(d, rd);
    const hotGap = hd.left - he.right;

    const at = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.id || el.className.split(' ')[0]) : null;
    };
    const y = re.top + re.height / 2;
    const inGap = [];
    for (let t = 0; t <= 1.0001; t += 0.1) inGap.push(at(re.right + gap * t, y));

    const card = document.querySelector('.card').getBoundingClientRect();
    return {
      boxW: +re.width.toFixed(2), boxH: +re.height.toFixed(2), gap: +gap.toFixed(2),
      hotE: `${he.w.toFixed(1)}×${he.h.toFixed(1)}`, hotD: `${hd.w.toFixed(1)}×${hd.h.toFixed(1)}`,
      hotW: Math.min(he.w, hd.w), hotH: Math.min(he.h, hd.h),
      insetE: he.inset, insetD: hd.inset,
      hotGap: +hotGap.toFixed(2), overlap: hotGap < 0,
      inGap,
      外左: at(he.left + 1, y), 外右: at(hd.right - 1, y),
      上外: at(re.left + re.width / 2, he.top + 1), 下外: at(re.left + re.width / 2, he.bottom - 1),
      rowH: +document.querySelector('.meal').getBoundingClientRect().height.toFixed(2),
      上余量: +(re.top - card.top).toFixed(2), 下余量: +(card.bottom - re.bottom).toFixed(2),
      docScrollW: document.scrollingElement.scrollWidth,
    };
  });
  await browser.close();
  return r;
};

let failed = 0;
const assert = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };

for (const w of [320, 360, 390]) {
  const base = await run(w, null);
  console.log(`\n=== ${w}px ===`);
  console.log(`实盒 ${base.boxW}×${base.boxH}，间隙 ${base.gap}px，行高 ${base.rowH}`);
  console.log(`不加 ::before 时间隙取样：${JSON.stringify(base.inGap)}`);
  assert(base.hotW === base.boxW && base.hotH === base.boxH, `无 ::before 时热区=实盒（${base.hotE} / ${base.hotD}）`);

  for (const v of Object.keys(VARIANTS)) {
    const r = await run(w, v);
    console.log(`\n  [${v}] 热区 ${r.hotE} / ${r.hotD}（inset ${r.insetE} / ${r.insetD}）`);
    console.log(`  热区间隙 ${r.hotGap}px，重叠=${r.overlap}，行高 ${r.rowH}`);
    console.log(`  间隙取样：${JSON.stringify(r.inGap)}`);
    console.log(`  外侧取样：左 ${r.外左} / 右 ${r.外右} / 上 ${r.上外} / 下 ${r.下外}`);
    console.log(`  竖向余量：上 ${r.上余量} / 下 ${r.下余量}`);

    assert(r.hotW >= 44 && r.hotH >= 44, `热区达 44×44（${r.hotW.toFixed(1)}×${r.hotH.toFixed(1)}）`);
    assert(!r.overlap, `相邻热区不重叠（余 ${r.hotGap}px）`);
    assert(r.外左 === 'e' && r.外右 === 'd', '外侧确实能点中（左 e / 右 d）');
    if (v === '只向外侧4px') {
      assert(JSON.stringify(r.inGap) === JSON.stringify(base.inGap),
        '间隙取样与不加 ::before 时完全一致 —— 中间 6px 保持中性，归属边界没动');
    } else {
      assert(JSON.stringify(r.inGap) !== JSON.stringify(base.inGap),
        '对称扩会吃掉一部分间隙（所以旧注释担心的事只在「扩到重叠」时才发生）');
    }
  }
}

console.log(failed ? `\n${failed} 条断言失败\n` : '\n全部断言通过\n');
process.exit(failed ? 1 : 0);
