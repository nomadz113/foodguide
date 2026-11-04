/**
 * 启动屏 v2 设计稿渲染器。
 *
 * 为什么用 SVG 而不是直接写 Java：这份稿子的每个数字都要原样搬到 SplashView 的
 * onDraw 里。SVG 的单位和 Canvas 的像素一一对应，都是 1080×1920 的设计坐标系，
 * 比例系数也直接写在注释里 —— 两边不会因为「顺手调一下」而漂。
 *
 * ── 色值从哪来 ───────────────────────────────────────────────
 * **直接读 res/values[-night]/colors.xml**，不在这里另抄一份。
 * 以前这里硬编码了一套色板，Java 里又写死了一套，两边迟早分叉
 * （0.8.8 修启动屏时就发现轨道半径差 22px、光带浓淡方向还是反的）。
 * 现在浓淡也放进颜色资源的 alpha 通道，稿子和 APK 读的是同一份 XML。
 *
 * ── 形状怎么和 Canvas 对齐 ──────────────────────────────────
 * Canvas 只有一张横向的 LinearGradient（负责左右羽化），纵向浓淡只能靠
 * 「一叠薄片 + 每片一个 alpha」堆出来。所以这里不画平滑渐变，而是照着
 * SplashView.drawScan 的循环逐片画 rect —— 稿子里看到的锯齿就是真机上的锯齿。
 * 轨道弧同理：原生按 72 段递减 alpha，这里也按 72 段画。
 *
 * 用法：node tools/render-splash.mjs [屏高]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../../design/splash-v2');
const APP = resolve(HERE, '../../app');
const OUT = HERE;
mkdirSync(OUT, { recursive: true });

// 启动屏图标跟系统夜间模式走：日间浅底、夜间深底，两版是不同的资源文件
const LOGO = {
  light: readFileSync(
    resolve(APP, 'android/app/src/main/res/drawable-nodpi/ic_splash_logo.png'),
  ).toString('base64'),
  dark: readFileSync(
    resolve(APP, 'android/app/src/main/res/drawable-night-nodpi/ic_splash_logo.png'),
  ).toString('base64'),
};

/* ── 设计坐标（1080×1920 基准，可换屏高做验收）────────────────────
   注意：换 H 之后 CY 和整个文字块都要跟着动 —— 原生代码就是这么算的
   （ICON_CY 是屏高比例、TEXT_TOP 也是屏高比例、字号与取景框是屏宽比例），
   这份稿子必须同构，否则验出来的「高屏版」是假的。 */
const H = Number(process.argv[2] || 1920);
const W = 1080, CX = 540;
const CY = Math.round(H * 0.3646);        // 主视觉中心
const DT = Math.round(H * 0.556) - 1067;  // 文字块整体位移（1920 稿下为 0）
const ICON = 320;                // 0.296 × W（沿用旧稿）
const FRAME = 310;               // 取景框半边长（520 边长）
const FRAME_R = 76;              // 圆角
const FRAME_LEG = 118;           // 每个角的臂长
const ORBIT_R = 240;             // 0.2222 × W（原生 ORBIT_R_RATIO 同值）
const GLOW_R = 620;
const DOT_STEP = 44;
const DOT_R = 1.35;
const HALO_SIGMA = 19;           // 原生 BlurMaskFilter 半径 32px 换算成的 stdDeviation

/* 扫描：与 SplashView.drawScan 同参数 */
const BAND_SLICES = 12;
const BAND_H = 84;               // 光片半高（SCAN_BAND_RATIO 0.0778 × 1080）
const SCAN_SLICE_FALLOFF = 1.5;  // 纵向衰减指数

/* 轨道：与 SplashView.drawOrbit 同参数 */
const ARC_SEGMENTS = 72;
const ARC_SPAN = 140;
const ARC_BASE = -122;           // 静态取一帧（原生 base = -90 + orbitDeg）
const ARC_HEAD_ALPHA = 0.6;

/* 心电：与 SplashEcgView 同参数（24dp 视图高 → 72px，振幅 0.34 → 24.5px） */
const ECG_AMP = 24.5;

/* ── 色值：读 Android 的颜色资源 ───────────────────────────────────
   格式 #AARRGGBB，解析成 { rgb: '#rrggbb', a: 0..1 }。
   读不到就报错 —— 宁可停下，也不要静默用一份抄错的色板。 */
function readColors(file) {
  const xml = readFileSync(file, 'utf8');
  const out = {};
  for (const m of xml.matchAll(/<color\s+name="([^"]+)"\s*>([^<]+)<\/color>/g)) {
    const hex = m[2].trim();
    const n = parseInt(hex.slice(1), 16);
    const a = ((n >>> 24) & 255) / 255;
    const rgb = '#' + (n & 0xffffff).toString(16).padStart(6, '0');
    out[m[1]] = { rgb, a, hex };
  }
  return out;
}

function pick(cs, name) {
  const c = cs[name];
  if (!c) throw new Error(`colors.xml 里没有 ${name}`);
  return c;
}

/* ── 文案：读 Android 的字符串资源 ─────────────────────────────────
   和色值同一个道理：稿子上的品牌名 / slogan 必须跟真机读的是同一份 XML。
   这里以前硬编码了一份，0.9.0 改名时就发现 slogan 还是旧的 —— 同类分叉
   在 0.8.8 的色板上已经栽过 5 处，文案不该重蹈覆辙。 */
function readStrings(file) {
  const xml = readFileSync(file, 'utf8');
  const out = {};
  for (const m of xml.matchAll(/<string\s+name="([^"]+)"\s*>([^<]*)<\/string>/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function pickStr(ss, name) {
  const v = ss[name];
  if (!v) throw new Error(`strings.xml 里没有 ${name}`);
  return v;
}

const STRINGS = readStrings(resolve(APP, 'android/app/src/main/res/values/strings.xml'));
const SLOGAN = pickStr(STRINGS, 'splash_slogan');
const BRAND = pickStr(STRINGS, 'splash_brand');

const DARK = readColors(resolve(APP, 'android/app/src/main/res/values-night/colors.xml'));
const LIGHT = readColors(resolve(APP, 'android/app/src/main/res/values/colors.xml'));

const PAL = {
  dark: {
    bg: pick(DARK, 'splash_bg').rgb,
    fg: pick(DARK, 'splash_ink').rgb,
    dim: pick(DARK, 'splash_ink_dim').rgb,
    brand: pick(DARK, 'splash_brand').rgb,
    warm: pick(DARK, 'splash_warm'),
    glowCore: pick(DARK, 'splash_glow_core'),
    glowMid: pick(DARK, 'splash_glow_mid'),
    frame: pick(DARK, 'splash_frame'),
    scan: pick(DARK, 'splash_scan'),
    band: pick(DARK, 'splash_band'),
    halo: pick(DARK, 'splash_halo'),
    dot: pick(DARK, 'splash_dot'),
  },
  light: {
    bg: pick(LIGHT, 'splash_bg').rgb,
    fg: pick(LIGHT, 'splash_ink').rgb,
    dim: pick(LIGHT, 'splash_ink_dim').rgb,
    brand: pick(LIGHT, 'splash_brand').rgb,
    warm: pick(LIGHT, 'splash_warm'),
    glowCore: pick(LIGHT, 'splash_glow_core'),
    glowMid: pick(LIGHT, 'splash_glow_mid'),
    frame: pick(LIGHT, 'splash_frame'),
    scan: pick(LIGHT, 'splash_scan'),
    band: pick(LIGHT, 'splash_band'),
    halo: pick(LIGHT, 'splash_halo'),
    dot: pick(LIGHT, 'splash_dot'),
  },
};

/* ── 图标形状 ────────────────────────────────────────────────────
   取景框四角：只画角，不画整框 —— 完整方框会像「加载中」的占位框 */
function corners() {
  const x0 = CX - FRAME, x1 = CX + FRAME, y0 = CY - FRAME, y1 = CY + FRAME;
  const r = FRAME_R, l = FRAME_LEG;
  const q = (sx, sy, ex, ey) => `Q${sx},${sy} ${ex},${ey}`;
  return [
    `M${x0},${y0 + l} L${x0},${y0 + r} ${q(x0, y0, x0 + r, y0)} L${x0 + l},${y0}`,
    `M${x1 - l},${y0} L${x1 - r},${y0} ${q(x1, y0, x1, y0 + r)} L${x1},${y0 + l}`,
    `M${x1},${y1 - l} L${x1},${y1 - r} ${q(x1, y1, x1 - r, y1)} L${x1 - l},${y1}`,
    `M${x0 + l},${y1} L${x0 + r},${y1} ${q(x0, y1, x0, y1 - r)} L${x0},${y1 - l}`,
  ].map((d) => `<path d="${d}" fill="none" />`).join('');
}

/** 点阵：中心密、边缘散，用 clip 圆 + 径向淡出 */
function dots(p) {
  return `<defs>
    <pattern id="dpat" width="${DOT_STEP}" height="${DOT_STEP}" patternUnits="userSpaceOnUse">
      <circle cx="${DOT_STEP / 2}" cy="${DOT_STEP / 2}" r="${DOT_R}" fill="${p.dot.rgb}" />
    </pattern>
    <radialGradient id="dfade">
      <stop offset="0" stop-color="#fff" stop-opacity="1" />
      <stop offset="0.55" stop-color="#fff" stop-opacity="0.45" />
      <stop offset="1" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
    <mask id="dmask">
      <circle cx="${CX}" cy="${CY}" r="${GLOW_R}" fill="url(#dfade)" />
    </mask>
  </defs>
  <g mask="url(#dmask)" opacity="${p.dot.a}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#dpat)" />
  </g>`;
}

/** 心电：横贯全宽的「健康线」，同时充当版式分割线。形状照 SplashEcgView 的比例。 */
function ecg() {
  const y = 1440 + DT;
  const a = ECG_AMP;
  return `<path d="M70 ${y} H404 L422 ${y} L434 ${(y - a * 0.33).toFixed(1)} L448 ${(y + a * 0.60).toFixed(1)} L464 ${(y - a).toFixed(1)} L480 ${(y + a * 0.45).toFixed(1)} L494 ${y} H1010"
    fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
}

function iconCamera(color, o) {
  return `<g transform="translate(0,0) scale(${o})" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2.9" y="7.2" width="18.2" height="13.4" rx="3.6" />
    <path d="M8.6 7.2V5.7a1.7 1.7 0 0 1 1.7-1.7h3.4a1.7 1.7 0 0 1 1.7 1.7v1.5" />
    <circle cx="12" cy="13.9" r="3.7" />
  </g>`;
}

function iconSparkle(color, o) {
  return `<g transform="scale(${o})" fill="${color}">
    <path d="M11.2 2.2c.85 4.7 2.5 6.35 7.2 7.2-4.7.85-6.35 2.5-7.2 7.2-.85-4.7-2.5-6.35-7.2-7.2 4.7-.85 6.35-2.5 7.2-7.2z" />
    <path d="M18.4 14.2c.45 2.5 1.35 3.4 3.85 3.85-2.5.45-3.4 1.35-3.85 3.85-.45-2.5-1.35-3.4-3.85-3.85 2.5-.45 3.4-1.35 3.85-3.85z" opacity="0.75" />
  </g>`;
}

function iconHeart(color, o) {
  return `<g transform="scale(${o})" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 20.3C12 20.3 3.4 15.1 3.4 9.3c0-2.7 2.1-4.8 4.7-4.8 1.7 0 3.9 2.3 3.9 2.3z" />
    <path d="M12 20.3C12 20.3 20.6 15.1 20.6 9.3c0-2.7-2.1-4.8-4.7-4.8-1.7 0-3.9 2.3-3.9 2.3z" />
    <path d="M6.6 11.4h2.3l1.1-1.9 1.5 3.6 1.1-1.7h4.8" />
  </g>`;
}

const FEATS = [
  { label: '拍照记录', icon: iconCamera },
  { label: 'AI 识别', icon: iconSparkle },
  { label: '健康建议', icon: iconHeart },
];

/** 轨道弧：照 SplashView.drawOrbit 的 72 段递减 alpha 画，尾部拖在顺时针侧 */
function orbit(p) {
  const rad = Math.PI / 180;
  let out = '';
  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const t = i / ARC_SEGMENTS;
    const a0 = (ARC_BASE + t * ARC_SPAN) * rad;
    const a1 = (ARC_BASE + Math.min(1, (i + 1.7) / ARC_SEGMENTS) * ARC_SPAN) * rad;
    const x0 = CX + ORBIT_R * Math.cos(a0), y0 = CY + ORBIT_R * Math.sin(a0);
    const x1 = CX + ORBIT_R * Math.cos(a1), y1 = CY + ORBIT_R * Math.sin(a1);
    const alpha = Math.pow(1 - t, 1.6) * ARC_HEAD_ALPHA;
    out += `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${ORBIT_R},${ORBIT_R} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}"
      fill="none" stroke="${p.brand}" stroke-width="2.6" stroke-linecap="round" opacity="${alpha.toFixed(4)}" />`;
  }
  const kx = CX + ORBIT_R * Math.cos(ARC_BASE * rad);
  const ky = CY + ORBIT_R * Math.sin(ARC_BASE * rad);
  out += `<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="5.4" fill="${p.brand}" opacity="0.9" />`;
  return out;
}

/**
 * 扫描光片：照 SplashView.drawScan 逐片画。
 * 浓淡 = 扫描线浓淡 × 光带峰值浓淡 × 该片的衰减；横向羽化由 url(#scan) 提供。
 * 扫描线停在画面中段（原生是动的，静态取一帧），光片紧贴它上下各铺 BAND_H。
 */
function scanSheet(p) {
  const y = CY - FRAME + 384;   // 静态取线停在取景框中下方
  const slice = BAND_H / BAND_SLICES;
  const peak = p.band.a * p.scan.a;
  let out = '';
  for (let i = 0; i < BAND_SLICES; i++) {
    const k = (BAND_SLICES - i) / BAND_SLICES;
    const alpha = peak * Math.pow(k, SCAN_SLICE_FALLOFF);
    const x0 = CX - FRAME, x1 = CX + FRAME;
    out += `<rect x="${x0}" y="${(y - (i + 1) * slice).toFixed(1)}" width="${FRAME * 2}"
      height="${(slice + 0.6).toFixed(1)}" fill="url(#scan)" opacity="${alpha.toFixed(4)}" />`;
    out += `<rect x="${x0}" y="${(y + i * slice).toFixed(1)}" width="${FRAME * 2}"
      height="${(slice + 0.6).toFixed(1)}" fill="url(#scan)" opacity="${alpha.toFixed(4)}" />`;
  }
  out += `<rect x="${CX - FRAME}" y="${(y - 1.3).toFixed(1)}" width="${FRAME * 2}" height="2.6"
    fill="url(#scan)" opacity="${p.scan.a}" />`;
  return out;
}

function scene(theme) {
  const p = PAL[theme];
  const iconY = CY - ICON / 2;

  /* 三个能力标签：横排成一条「流水线」，组与组之间用一根短横线相连 ——
     三件事在 App 里本来就是一条链路（拍 → 认 → 建议），不是三个并列卖点。 */
  const FY = 1312 + DT, ICON_PX = 66, GAP = 16, LBL = 33;
  const labelW = (s) => (s.replace(/[A-Za-z0-9 ]/g, '').length * LBL) + (s.match(/[A-Za-z0-9 ]/g) || []).length * LBL * 0.58;
  const itemW = FEATS.map((f) => ICON_PX + GAP + labelW(f.label));
  const LINK = 56;
  const SIDE = 26;
  const GROUP_GAP = SIDE * 2 + LINK;
  const total = itemW.reduce((a, b) => a + b, 0) + GROUP_GAP * (FEATS.length - 1);
  let x = CX - total / 2;

  const feats = FEATS.map((f, i) => {
    const w = itemW[i];
    const g = `<g>
      <g transform="translate(${x},${FY - ICON_PX / 2}) scale(${ICON_PX / 24})">${f.icon(p.brand, 1)}</g>
      <text x="${x + ICON_PX + GAP}" y="${FY + LBL * 0.36}" fill="${p.dim}"
        font-size="${LBL}" font-weight="500" letter-spacing="0.5">${f.label}</text>
    </g>`;
    const end = x + w;
    x += w + GROUP_GAP;
    if (i < FEATS.length - 1) {
      const sx = end + SIDE;
      return g + `<line x1="${sx}" y1="${FY}" x2="${sx + LINK}" y2="${FY}"
        stroke="${p.brand}" stroke-width="1.8" stroke-linecap="round" opacity="0.30" />`;
    }
    return g;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="warm" gradientUnits="userSpaceOnUse" cx="880" cy="250" r="560">
      <stop offset="0" stop-color="${p.warm.rgb}" stop-opacity="${p.warm.a}" />
      <stop offset="1" stop-color="${p.warm.rgb}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY}" r="${GLOW_R}">
      <stop offset="0" stop-color="${p.glowCore.rgb}" stop-opacity="${p.glowCore.a}" />
      <stop offset="0.38" stop-color="${p.glowMid.rgb}" stop-opacity="${p.glowMid.a}" />
      <stop offset="1" stop-color="${p.glowMid.rgb}" stop-opacity="0" />
    </radialGradient>
    <!-- 扫描用的横向羽化：两端透明、中段实。原生的 LinearGradient 就是它。 -->
    <linearGradient id="scan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.brand}" stop-opacity="0" />
      <stop offset="0.16" stop-color="${p.brand}" stop-opacity="1" />
      <stop offset="0.84" stop-color="${p.brand}" stop-opacity="1" />
      <stop offset="1" stop-color="${p.brand}" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="ecgg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.brand}" stop-opacity="0.06" />
      <stop offset="0.32" stop-color="${p.brand}" stop-opacity="0.30" />
      <stop offset="0.5" stop-color="${p.brand}" stop-opacity="0.62" />
      <stop offset="0.68" stop-color="${p.brand}" stop-opacity="0.30" />
      <stop offset="1" stop-color="${p.brand}" stop-opacity="0.06" />
    </linearGradient>
    <filter id="halo" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${HALO_SIGMA}" />
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="${p.bg}" />
  <circle cx="880" cy="250" r="560" fill="url(#warm)" />
  <rect x="${CX - GLOW_R}" y="${CY - GLOW_R}" width="${GLOW_R * 2}" height="${GLOW_R * 2}" fill="url(#glow)" />
  ${dots(p)}

  <!-- 取景框四角 -->
  <g stroke="${p.brand}" stroke-width="4.4" stroke-linecap="round" opacity="${p.frame.a}">${corners()}</g>

  <!-- 轨道 + 读数头（品牌既有动效） -->
  ${orbit(p)}

  <!-- 图标外发光：原生是离屏 Canvas 上用 BlurMaskFilter 预渲染的一张位图，
       画在图标下面。SVG 这里用同样的圆角矩形 + 高斯模糊近似。 -->
  <g filter="url(#halo)" opacity="${p.halo.a}">
    <rect x="${CX - ICON / 2}" y="${iconY}" width="${ICON}" height="${ICON}"
      rx="${(ICON * 0.215).toFixed(1)}" fill="${p.halo.rgb}" />
  </g>

  <!-- 图标本体（保留原 logo，不重绘；深浅两版分别取 drawable-nodpi / drawable-night-nodpi） -->
  <image href="data:image/png;base64,${LOGO[theme]}" x="${CX - ICON / 2}" y="${iconY}" width="${ICON}" height="${ICON}" />

  <!-- 扫描线：拍照识别的核心隐喻，画在最上层 —— 真的扫描是光片从被摄物上扫过，
       压在图标下方会变成「图标两边各有一段线」，读不出扫描的意思。 -->
  ${scanSheet(p)}

  <!-- 主标语（读 strings.xml 的 splash_slogan） -->
  <text x="${CX}" y="${1130 + DT}" fill="${p.fg}" font-size="84" font-weight="700"
    text-anchor="middle" letter-spacing="-1.5">${SLOGAN}</text>
  <!-- 品牌名：小字 + 大字距，做「署名」而不是第二行标题（读 splash_brand） -->
  <text x="${CX}" y="${1200 + DT}" fill="${p.dim}" font-size="31" font-weight="500"
    text-anchor="middle" letter-spacing="10" opacity="0.95">${BRAND}</text>

  ${feats}

  <g stroke="url(#ecgg)" stroke-width="2.6">${ecg()}</g>

  <text x="${CX}" y="${1556 + DT}" fill="${p.dim}" font-size="27" text-anchor="middle"
    letter-spacing="1.5" opacity="0.55">数据只存本机 · 离线可用 · 无需登录</text>
</svg>`;
}

const board = (theme) => `<figure class="art ${theme}">${scene(theme)}</figure>`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1b1d21; display: flex; gap: 40px; padding: 40px; align-items: flex-start;
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
  .art { width: 540px; height: ${H / 2}px; border-radius: 18px; overflow: hidden; }
  .art svg { width: 540px; height: ${H / 2}px; display: block; }
</style></head><body>${board('dark')}${board('light')}</body></html>`;

writeFileSync(resolve(OUT, 'board.html'), html);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  defaultViewport: { width: 1160, height: 1040, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto('file:///' + resolve(OUT, 'board.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: resolve(OUT, `board-${H}.png`), fullPage: true });

// 单张全尺寸（540×960 CSS @2x = 1080×1920 位图）
for (const t of ['dark', 'light']) {
  writeFileSync(resolve(OUT, `one-${t}.html`),
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>*{margin:0}body{font-family:"PingFang SC","Microsoft YaHei",sans-serif}svg{width:540px;height:${H / 2}px;display:block}</style></head><body>${scene(t)}</body></html>`);
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 540, height: H / 2, deviceScaleFactor: 2 });
  await p2.goto('file:///' + resolve(OUT, `one-${t}.html`).replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 200));
  await p2.screenshot({ path: resolve(OUT, `splash-${t}.png`) });
  await p2.close();
}

await browser.close();
console.log('ok');
