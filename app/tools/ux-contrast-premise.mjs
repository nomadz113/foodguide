/**
 * 「条件对比度」断言：凡是规范里写「某对比度达标」的数，都验一遍**它依赖的前提**。
 *
 * 起因：`--bar-fg` 的 4.58~6.26 是按「数字永远坐在橄榄柱上」算的，而目标虚线的
 * 1px 卡片色切缝在数字下方垫了一条 `--card` 色的带 → 数字背景被换掉 →
 * 浅色 1.01:1、深色 1.01:1，数字被抹断。**数没算错，前提被改了。**
 *
 * 这个脚本把四组「前提」写成可跑断言，并对**可调的那个维度**反解临界值：
 *
 *   1. `--bar-fg` × `--bar-bg` 渐变两端         ≥ 4.5  （柱内数字的基本前提）
 *   2. `--bar-fg` × `--card`                    必 < 4.5（切缝把底色换成卡片底时的值 —— 这条"失败"是断言的一部分，
 *                                                       它就是 `.cval.low` 存在的理由）
 *   3. `--on-photo` × (`--on-photo-bg` 叠在照片上) ≥ 4.5（反解遮罩透明度的临界值）
 *   4. `--target-line` × `--card`               ≥ 3.0  （图形元素下限）
 *
 * 用法：node tools/ux-contrast-premise.mjs   （失败 exit 1）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(APP, 'src/index.css'), 'utf8');

// ── WCAG 2.1 ──
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const cr = (a, b) => { const hi = Math.max(L(a), L(b)), lo = Math.min(L(a), L(b)); return (hi + 0.05) / (lo + 0.05); };
const hex = (s) => { const h = s.trim().replace('#', ''); const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)); };
const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((v) => parseFloat(v)); return { rgb: p.slice(0, 3).map((v) => v), a: p.length > 3 ? p[3] : 1 }; };
const over = (fg, bg, a) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));

/** 抓某个主题块里所有 `--token: value;` */
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const darkBlock = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='light']"));
const lightBlock = css.slice(css.indexOf(":root[data-theme='light']"));
const THEMES = { 深色: tokens(darkBlock), 浅色: tokens(lightBlock) };

/** 把 token 值解析成「若干颜色」：纯色 / rgba / 渐变取两端 */
function colors(v) {
  if (!v) return [];
  const grad = [...v.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => hex(m[0]));
  if (grad.length) return grad;
  const r = rgba(v);
  return r ? [r.rgb] : [];
}
/** 带 alpha 的 token → {rgb, a} */
function paint(v) {
  if (!v) return { rgb: [0, 0, 0], a: 1 };
  if (/gradient/.test(v)) return { rgb: colors(v)[0], a: 1 };
  const r = rgba(v);
  if (r) return r;
  return { rgb: hex(v), a: 1 };
}

let failed = 0;
const assert = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };
const row = (label, value, need) => console.log(`    ${label.padEnd(34)} ${value.toFixed(2)}:1${need ? `（需 ≥${need}）` : ''}`);

for (const [themeName, t] of Object.entries(THEMES)) {
  console.log(`\n=== ${themeName} ===`);

  // 1. 柱内数字 × 柱体渐变两端
  const barFg = paint(t['--bar-fg']).rgb;
  const barEnds = colors(t['--bar-bg']);
  console.log('  1) `--bar-fg` × `--bar-bg` 两端');
  const barCrs = barEnds.map((c) => cr(barFg, c));
  barEnds.forEach((c, i) => row(`柱体色 #${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`, barCrs[i], 4.5));
  assert(barCrs.every((v) => v >= 4.5), `柱内数字在渐变两端都 ≥4.5:1（最低 ${Math.min(...barCrs).toFixed(2)}）`);

  // 超限柱是另一组值（`--bar-over`），不是柱体那组。混成一列会让"最低 4.74"这句话失真。
  const overEnds = colors(t['--bar-over']);
  console.log('  1b) `--bar-fg` × `--bar-over` 两端（超限柱）');
  const overCrs = overEnds.map((c) => cr(barFg, c));
  overEnds.forEach((c, i) => row(`超限柱色 #${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`, overCrs[i], 4.5));
  assert(overCrs.every((v) => v >= 4.5), `超限柱上的数字也 ≥4.5:1（最低 ${Math.min(...overCrs).toFixed(2)}，余量 ${(Math.min(...overCrs) - 4.5).toFixed(2)}）`);
  if (Math.min(...overCrs) - 4.5 < 0.5) console.log(`    ⚠ 超限柱余量只有 ${(Math.min(...overCrs) - 4.5).toFixed(2)} —— 改 --bar-over 前必须重跑`);

  // 2. 同一前景 × 卡片底 —— 这是「切缝换掉底色」时的真实值，必须 <4.5
  const card = paint(t['--card']).rgb;
  console.log('  2) `--bar-fg` × `--card`（切缝垫底时）');
  const onCard = cr(barFg, card);
  row('数字色 × 卡片底', onCard, 4.5);
  assert(onCard < 4.5 || Math.abs(L(barFg) - L(card)) < 0.02,
    `数字底色一换成卡片底就不达标（${onCard.toFixed(2)}）—— 这就是 .cval 必须让路、不能只靠 z-index 的原因`);

  // 3. 目标虚线 × 卡片底（图形下限 3.0）
  const tl = paint(t['--target-line']);
  const overCard = over(tl.rgb, card, tl.a);
  console.log('  3) `--target-line` × 卡片底 / 页底');
  row('虚线合成色 × 卡片底', cr(overCard, card), 3.0);
  assert(cr(overCard, card) >= 3.0, `目标虚线对卡片 ≥3:1（${cr(overCard, card).toFixed(2)}）`);
  // 分母不只 `--card`：图表一旦搬出卡片（或卡片去掉底色）虚线就落在 `--bg` 上，
  // 而 `--bg` 比 `--card` 更暗/更深，是更难的那一侧。只断言 card，改 bg 时脚本不会响。
  const pageBg = paint(t['--bg']).rgb;
  const overBg = over(tl.rgb, pageBg, tl.a);
  row('虚线合成色 × 页底', cr(overBg, pageBg), 3.0);
  assert(cr(overBg, pageBg) >= 3.0, `目标虚线对页底 ≥3:1（${cr(overBg, pageBg).toFixed(2)}）`);
  const bgMargin = cr(overBg, pageBg) - 3.0;
  if (bgMargin < 0.5) console.log(`    ⚠ 页底余量只有 ${bgMargin.toFixed(2)} —— 这是虚线最薄的一侧，改 \`--bg\` 必须重跑`);
  const seam = cr(card, barEnds[0]);
  row('切缝（=卡片色）× 柱体', seam, 3.0);
  assert(seam >= 3.0, `切缝对柱体 ≥3:1（${seam.toFixed(2)}）—— 这就是加缝之后线「连续」的量化依据`);
}

// 4. `--on-photo`：照片层恒定，两套主题共用
const t0 = THEMES['深色'];
const onPhoto = paint(t0['--on-photo']).rgb;
const mask = paint(t0['--on-photo-bg']);
console.log('\n=== 照片层（两套主题共用）===');
console.log('  4) `--on-photo` × (`--on-photo-bg` 叠在照片上)');
const photos = { 纯白: [255, 255, 255], 浅灰: [240, 240, 240], 亮黄: [255, 255, 0], 天蓝: [135, 206, 250], 中灰: [128, 128, 128], 纯黑: [0, 0, 0] };
let worst = [Infinity, ''];
for (const [name, p] of Object.entries(photos)) {
  const bg = over(mask.rgb, p, mask.a);
  const c = cr(onPhoto, bg);
  row(`照片${name}（遮罩 ${(mask.a * 100).toFixed(0)}%）`, c, 4.5);
  if (c < worst[0]) worst = [c, name];
}
assert(worst[0] >= 4.5, `最差照片（${worst[1]}）仍 ≥4.5:1（${worst[0].toFixed(2)}）`);

// 反解遮罩透明度的临界值：白底照片是最差情况
const needL = (L(onPhoto) + 0.05) / 4.5 - 0.05;
let lo = 0, hi = 1;
for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (L(over(mask.rgb, [255, 255, 255], m)) > needL) lo = m; else hi = m; }
console.log(`\n  临界：遮罩不透明度低于 ${(lo * 100).toFixed(1)}% 时，白底照片上的白字跌破 4.5:1`);
console.log(`  现值 ${(mask.a * 100).toFixed(1)}%，余量 ${((mask.a - lo) * 100).toFixed(1)} 个百分点 —— 改遮罩必须重算，不能用眼睛调`);
assert(mask.a - lo > 0.02, `遮罩余量 >2 个百分点（${((mask.a - lo) * 100).toFixed(1)}）—— 太薄的话一次「调淡一点」就击穿`);

console.log(failed ? `\n${failed} 条断言失败\n` : '\n全部断言通过\n');
process.exit(failed ? 1 : 0);
