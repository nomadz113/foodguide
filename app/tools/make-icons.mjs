/**
 * 生成安卓启动图标（各密度 PNG + 自适应图标前景）。
 *
 * 用 Edge 渲染一段 SVG 再按目标尺寸截图 —— 项目里没有图像库，
 * 但 puppeteer-core 本来就在（截图验收用），够用且不失真。
 *
 * 设计：浅色底 + 深绿进度环 + 环心一个「饭」字。
 *
 * 四套：
 *   ic_launcher.png          旧系统用，浅色圆角方 + 进度环 + 饭
 *   ic_launcher_round.png    圆形裁切版
 *   ic_launcher_foreground.png  自适应图标前景，透明底，内容缩到 66%（108dp 安全区）
 *   ic_splash_logo.png       启动屏图标，满版方形（圆角由 SplashView 按 0.215 比自己裁）
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RES = resolve(import.meta.dirname, '../android/app/src/main/res');
const DENSITY = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

/** 浅色图标色板：底是近白的极浅绿，环与字用品牌绿，保证白桌面上也分得清 */
const C = {
  bg0: '#ffffff',
  bg1: '#ddede5',
  edge: '#c3d8cd', // 外描边，防止纯白底在白桌面上糊掉
  track: '#d9e7de', // 未走完的轨
  arc0: '#15803d',
  arc1: '#22c55e',
  ink: '#15803d', // 「饭」字
  knob: '#ffffff', // 起点圆点，遮住轨与弧的接缝
  font: '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif',
};

/** 深色版：只服务启动屏的夜间配色（splash_bg 夜间是 #0b0e13），应用图标本身保持浅色 */
const CD = {
  bg0: '#16211b',
  bg1: '#0b0e13',
  edge: '#0b0e13',
  track: '#1d2a22',
  arc0: '#86efac',
  arc1: '#22c55e',
  ink: '#86efac',
  knob: '#0b0e13',
  font: C.font,
};

/** size: 输出像素；mode: legacy | round | fg | splash | splash-night */
function markup(size, mode) {
  const s = size;
  const sw = Math.max(1, s * 0.014);
  const h = sw / 2;
  const c = mode === 'splash-night' ? CD : C;
  // 启动屏图标自带 21.5% 圆角（原生 SplashView 的 HALO_CORNER_RATIO），四角透明
  const isSplash = mode === 'splash' || mode === 'splash-night';
  const bg =
    mode === 'fg'
      ? ''
      : isSplash
        ? `<rect width="${s}" height="${s}" rx="${s * 0.215}" ry="${s * 0.215}" fill="url(#bg)"/>`
        : mode === 'round'
          ? `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - h}" fill="url(#bg)" stroke="${c.edge}" stroke-width="${sw}"/>`
          : `<rect x="${h}" y="${h}" width="${s - sw}" height="${s - sw}" rx="${(s - sw) * 0.22}" ry="${(s - sw) * 0.22}" fill="url(#bg)" stroke="${c.edge}" stroke-width="${sw}"/>`;

  // 进度环：整体占画布 66%，自适应前景再缩一档（安全区）
  const scale = mode === 'fg' ? 0.5 : 0.66;
  const r = (s * scale) / 2;
  const cx = s / 2;
  const cy = s / 2;
  const w = Math.max(2, s * 0.088);
  // 从正上方起，顺时针 68%
  const sweep = 0.68;
  const a = -Math.PI / 2 + sweep * Math.PI * 2;
  const ex = cx + r * Math.cos(a);
  const ey = cy + r * Math.sin(a);
  const large = sweep > 0.5 ? 1 : 0;
  const arc = `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  // 字号按环内径走，留出环内的呼吸位
  const fs = r * 1.02;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="0.3" cy="0.1" r="1.1">
      <stop offset="0" stop-color="${c.bg0}"/>
      <stop offset="1" stop-color="${c.bg1}"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c.arc0}"/>
      <stop offset="1" stop-color="${c.arc1}"/>
    </linearGradient>
  </defs>
  ${bg}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.track}" stroke-width="${w}"/>
  <path d="${arc}" fill="none" stroke="url(#arc)" stroke-width="${w}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy - r}" r="${w * 0.46}" fill="${c.knob}"/>
  <text x="${cx}" y="${cy}" font-family=${JSON.stringify(c.font)} font-size="${fs}" font-weight="700"
    fill="${c.ink}" text-anchor="middle" dominant-baseline="central">饭</text>
</svg>`;
}

const html = (size, mode) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
   html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
   svg{display:block}
  </style></head><body>${markup(size, mode)}</body></html>`;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

async function shoot(size, mode, out) {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(html(size, mode), { waitUntil: 'load' });
  await page.screenshot({
    path: out,
    omitBackground: mode === 'fg' || mode === 'splash' || mode === 'splash-night',
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await page.close();
}

for (const [dpi, k] of Object.entries(DENSITY)) {
  const dir = resolve(RES, `mipmap-${dpi}`);
  mkdirSync(dir, { recursive: true });
  await shoot(Math.round(48 * k), 'legacy', resolve(dir, 'ic_launcher.png'));
  await shoot(Math.round(48 * k), 'round', resolve(dir, 'ic_launcher_round.png'));
  await shoot(Math.round(108 * k), 'fg', resolve(dir, 'ic_launcher_foreground.png'));
  console.log(`mipmap-${dpi}: 48dp→${Math.round(48 * k)}px, fg→${Math.round(108 * k)}px`);
}

// 启动屏图标：768，自带 21.5% 圆角（对齐 SplashView 的 HALO_CORNER_RATIO），四角透明
mkdirSync(resolve(RES, 'drawable-nodpi'), { recursive: true });
mkdirSync(resolve(RES, 'drawable-night-nodpi'), { recursive: true });
await shoot(768, 'splash', resolve(RES, 'drawable-nodpi/ic_splash_logo.png'));
await shoot(768, 'splash-night', resolve(RES, 'drawable-night-nodpi/ic_splash_logo.png'));
console.log('drawable-nodpi/ic_splash_logo.png        768×768（日间·浅底）');
console.log('drawable-night-nodpi/ic_splash_logo.png 768×768（夜间·深底）');

// 自适应图标背景色（纯色，跟渐变底同一调子）
writeFileSync(
  resolve(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#EDF5F0</color>
</resources>
`,
);

await browser.close();
console.log('icons done');
