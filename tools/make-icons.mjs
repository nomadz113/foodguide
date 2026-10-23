/**
 * 生成安卓启动图标（各密度 PNG + 自适应图标前景）。
 *
 * 用 Edge 渲染一段 SVG 再按目标尺寸截图 —— 项目里没有图像库，
 * 但 puppeteer-core 本来就在（截图验收用），够用且不失真。
 *
 * 三套：
 *   ic_launcher.png          旧系统用，深色圆角方 + 进度环
 *   ic_launcher_round.png    圆形裁切版
 *   ic_launcher_foreground.png  自适应图标前景，透明底，内容缩到 66%（108dp 安全区）
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

/** size: 输出像素；mode: legacy | round | fg */
function markup(size, mode) {
  const s = size;
  const bg =
    mode === 'fg'
      ? ''
      : mode === 'round'
        ? `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="url(#bg)"/>`
        : `<rect width="${s}" height="${s}" rx="${s * 0.22}" ry="${s * 0.22}" fill="url(#bg)"/>`;

  // 进度环：整体占画布 66%，自适应前景再缩一档（安全区）
  const scale = mode === 'fg' ? 0.5 : 0.66;
  const r = (s * scale) / 2;
  const cx = s / 2;
  const cy = s / 2;
  const w = Math.max(2, s * 0.085);
  // 从正上方起，顺时针 68%
  const sweep = 0.68;
  const a = -Math.PI / 2 + sweep * Math.PI * 2;
  const ex = cx + r * Math.cos(a);
  const ey = cy + r * Math.sin(a);
  const large = sweep > 0.5 ? 1 : 0;
  const arc = `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="0.3" cy="0.1" r="1.1">
      <stop offset="0" stop-color="#16211b"/>
      <stop offset="1" stop-color="#0b0e13"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#86efac"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  ${bg}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1d2a22" stroke-width="${w}"/>
  <path d="${arc}" fill="none" stroke="url(#arc)" stroke-width="${w}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy - r}" r="${w * 0.42}" fill="#0b0e13"/>
</svg>`;
}

const html = (size, mode) =>
  `<!DOCTYPE html><html><head><style>
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
    omitBackground: mode === 'fg',
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

// 自适应图标背景色
writeFileSync(
  resolve(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0B0E13</color>
</resources>
`,
);

await browser.close();
console.log('icons done');
