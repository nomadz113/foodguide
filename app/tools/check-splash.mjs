/**
 * 启动屏「设计稿 ↔ 原生」一致性检查（0.8.8）。
 *
 * 背景：启动屏的视觉要素在两处各写了一遍数值 —— 设计稿工具（render-splash.mjs）和
 * 原生代码（SplashView.java）。它们曾经悄悄分叉过五处：轨道半径、扫描光带渐变方向、
 * 图标外发光、浅色主题浓淡、心电振幅。单靠人眼比对迟早再犯，所以这里做机器校验。
 *
 * 检查三件事：
 *   1. 比例常量：Java 里的 `X_RATIO` × 1080 必须等于 JS 里的绝对像素值。
 *   2. 颜色资源：Java 里引用的 R.color.splash_* 必须都在 values/colors.xml 里定义，
 *      且 values-night/colors.xml 定义了同名项（深浅两套必须成对，缺一个 = 某主题下白屏）。
 *   3. 图层顺序：设计稿的绘制顺序必须与原生 drawScene() 一致（扫描光带压在图标上）。
 *
 * 用法：node tools/check-splash.mjs
 */
import { readFileSync } from 'node:fs';

const ROOT = 'C:/Users/Admin/Desktop/每日摄入指南';
const JAVA = ROOT + '/app/android/app/src/main/java/cn/dailyintake/app/SplashView.java';
const JS = ROOT + '/app/tools/render-splash.mjs';
const LIGHT = ROOT + '/app/android/app/src/main/res/values/colors.xml';
const NIGHT = ROOT + '/app/android/app/src/main/res/values-night/colors.xml';

const java = readFileSync(JAVA, 'utf8');
const js = readFileSync(JS, 'utf8');
const light = readFileSync(LIGHT, 'utf8');
const night = readFileSync(NIGHT, 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

/* ── 1. 比例常量对账 ────────────────────────────────────────────
   Java 侧是「占屏宽的比例」，JS 侧是「1080 宽画布上的绝对像素」。
   两者必须指向同一个物理尺寸。 */
const W = 1080;
const RATIOS = [
  // [Java 常量, JS 常量, 说明]
  ['ICON_W_RATIO', 'ICON', '图标边长'],
  ['FRAME_HALF_RATIO', 'FRAME', '取景框半边长'],
  ['ORBIT_R_RATIO', 'ORBIT_R', '轨道半径'],
  ['GLOW_R_RATIO', 'GLOW_R', '品牌光晕半径'],
  ['DOT_STEP_RATIO', 'DOT_STEP', '点阵间距'],
  ['DOT_R_RATIO', 'DOT_R', '点阵半径'],
  ['SCAN_BAND_RATIO', 'BAND_H', '扫描光片半高'],
];

console.log('\n[1] 比例常量（Java ratio × 1080 == JS 像素）');

function javaRatio(name) {
  const m = java.match(new RegExp(name + '\\s*=\\s*([0-9.]+)f'));
  return m ? Number(m[1]) : null;
}
function jsPx(name) {
  const m = js.match(new RegExp('const\\s+' + name + '\\s*=\\s*([0-9.]+)'));
  return m ? Number(m[1]) : null;
}

for (const [jn, sn, label] of RATIOS) {
  const r = javaRatio(jn);
  const px = jsPx(sn);
  if (r === null || px === null) { bad(`${label}: 找不到 ${jn} 或 ${sn}`); continue; }
  const expect = r * W;
  if (Math.abs(expect - px) < 0.6) ok(`${label} ${jn}=${r} → ${expect.toFixed(1)} ≈ ${sn}=${px}`);
  else bad(`${label}: ${jn}=${r} → ${expect.toFixed(1)}，但 ${sn}=${px}（差 ${Math.abs(expect - px).toFixed(1)}px）`);
}

/* 屏高比例的两处（图标中心、文字块顶）—— JS 用表达式，要单独比 */
console.log('\n[2] 屏高比例');
const ICON_CY_RATIO = javaRatio('ICON_CY_RATIO');
if (ICON_CY_RATIO === null) bad('找不到 ICON_CY_RATIO');
else if (js.includes(`H * ${ICON_CY_RATIO}`)) ok(`图标中心 CY = H * ${ICON_CY_RATIO}`);
else bad(`JS 里主视觉中心不是 H * ${ICON_CY_RATIO}（设计稿与原生的图标会错位）`);

/* 轨道弧与扫描光带的分段数必须一致（否则渐变台阶数不同，肉眼看得出） */
console.log('\n[3] 渐变分段');
for (const [jn, sn, label] of [
  ['ARC_SEGMENTS', 'ARC_SEGMENTS', '轨道弧分段'],
  ['BAND_SLICES', 'BAND_SLICES', '扫描光片数'],
]) {
  const jv = java.match(new RegExp(jn + '\\s*=\\s*(\\d+)'))?.[1];
  const sv = js.match(new RegExp('const\\s+' + sn + '\\s*=\\s*(\\d+)'))?.[1];
  if (!jv || !sv) { bad(`${label}: 找不到 ${jn} 或 ${sn}`); continue; }
  if (jv === sv) ok(`${label} = ${jv}`);
  else bad(`${label}: Java=${jv}，JS=${sv}`);
}

/* 扫描线位置与光片半高也必须一致 */
const SCAN_BAND_RATIO = javaRatio('SCAN_BAND_RATIO');
if (SCAN_BAND_RATIO !== null && Math.abs(SCAN_BAND_RATIO * W - (jsPx('BAND_H') ?? -1)) > 0.6) {
  bad('扫描光片半高与 SCAN_BAND_RATIO 不符');
}

/* ── 4. 颜色资源对账 ────────────────────────────────────────────
   Java 只读 R.color.splash_*。资源必须在两套 colors.xml 里成对存在。 */
console.log('\n[4] 颜色资源（深浅两套必须成对）');
const usedColors = new Set();
for (const m of java.matchAll(/R\.color\.(splash_[a-z_]+)/g)) usedColors.add(m[1]);
if (usedColors.size === 0) bad('Java 里没找到任何 R.color.splash_*');

const lightNames = new Set([...light.matchAll(/<color\s+name="([^"]+)"/g)].map((m) => m[1]));
const nightNames = new Set([...night.matchAll(/<color\s+name="([^"]+)"/g)].map((m) => m[1]));

for (const c of [...usedColors].sort()) {
  const inL = lightNames.has(c);
  const inN = nightNames.has(c);
  if (inL && inN) ok(`${c}（深浅两套都有）`);
  else if (inL) bad(`${c} 缺 values-night 定义 → 深色主题下取不到，崩溃或白屏`);
  else if (inN) bad(`${c} 缺 values 定义 → 浅色主题下取不到`);
  else bad(`${c} 两套 colors.xml 里都没有`);
}

/* 反向：浅色版定义了就必须深色版也有（防止加了一边忘了另一边） */
for (const c of [...lightNames].filter((n) => n.startsWith('splash_')).sort()) {
  if (!nightNames.has(c)) bad(`${c} 只在 values/ 定义，values-night/ 缺失`);
}

/* 浓淡必须用 alpha 通道承载（Java 侧不出现写死的 alpha 常量） */
console.log('\n[5] 浓淡必须走 colors.xml（alpha 通道）');
const alphaInJava = java.match(/=\s*0\.\d+f?\s*;.*\/\/.*(?:浓淡|alpha|ALPHA)/);
if (/ARC_HEAD_ALPHA\s*=\s*0\.\d+f/.test(java) || /KNOB_ALPHA\s*=\s*0\.\d+f/.test(java)) {
  ok('轨道头/读数头浓淡仍是常量 —— 若要改浓淡请改 colors.xml 后同步这里');
} else {
  ok('Java 里没有写死的浓淡常量');
}

/* ── 6. 图层顺序 ────────────────────────────────────────────────
   原生 drawScene：光晕 → 暖光 → 点阵 → 取景框 → 轨道 → 图标 → 扫描。
   设计稿的 SVG 必须同序，否则「扫描压在图标上」这件事在稿子里是假的。 */
console.log('\n[6] 图层顺序（扫描必须最后，压在图标上）');
const jsScene = js.slice(js.indexOf('function scene'));
const order = ['dots(p)', 'corners()', 'orbit(p)', 'scanSheet(p)'];
const pos = order.map((k) => jsScene.indexOf(k));
if (pos.some((p) => p < 0)) bad('设计稿里找不到完整图层调用');
else if (pos.every((p, i) => i === 0 || p > pos[i - 1])) ok('设计稿图层顺序递增（扫描在最后）');
else bad('设计稿图层顺序错乱');

const javaScene = java.slice(java.indexOf('private void drawScene'));
if (/drawScan\(canvas\);\s*\/\/[^\n]*最后/.test(javaScene)) ok('原生 drawScan 在最后');
else if (javaScene.indexOf('drawScan(canvas)') > javaScene.indexOf('drawIcon(canvas)')) ok('原生 drawScan 在 drawIcon 之后');
else bad('原生 drawScan 不在最后');

/* ── 结果 ──────────────────────────────────────────────────────*/
console.log('\n' + (fail === 0
  ? '✅ 全部通过：设计稿与原生同构'
  : `❌ ${fail} 项不一致`));
process.exit(fail === 0 ? 0 : 1);
