/**
 * 生成 PWA 图标（public/ 下，随构建复制到 dist）。
 *
 * - icon-192 / icon-512：圆角方形，浏览器与安卓主屏用
 * - icon-512-maskable：满版底色 + 内容收到 46%，给安卓自适应裁切留安全区
 * - apple-touch-icon-180：满版方形（iOS 自己套圆角，不能预先裁）
 *
 * 设计：浅色底 + 深绿进度环 + 环心一个「饭」字（32px 太小，只画环）。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public');
mkdirSync(OUT, { recursive: true });

/** 与 make-icons.mjs 同一套浅色色板，改一处要改两处 */
const C = {
  bg0: '#ffffff',
  bg1: '#ddede5',
  edge: '#c3d8cd',
  track: '#d9e7de',
  arc0: '#15803d',
  arc1: '#22c55e',
  ink: '#15803d',
  knob: '#ffffff',
  font: '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif',
};

/** shape: rounded | square | maskable */
function markup(size, shape) {
  const s = size;
  const radius = shape === 'rounded' ? (s - 1) * 0.22 : 0;
  const ringScale = shape === 'maskable' ? 0.46 : 0.62;
  const sw = Math.max(1, s * 0.02); // 小尺寸按比例加粗描边，免得看不见
  const h = sw / 2;

  const bg =
    shape === 'rounded'
      ? `<rect x="${h}" y="${h}" width="${s - sw}" height="${s - sw}" rx="${radius}" ry="${radius}" fill="url(#bg)" stroke="${C.edge}" stroke-width="${sw}"/>`
      : `<rect width="${s}" height="${s}" fill="url(#bg)"/>`;

  const cx = s / 2;
  const cy = s / 2;
  const r = (s * ringScale) / 2;
  const w = Math.max(2, s * 0.082);
  const sweep = 0.68;
  const a = -Math.PI / 2 + sweep * Math.PI * 2;
  const ex = cx + r * Math.cos(a);
  const ey = cy + r * Math.sin(a);
  const arc = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${ex} ${ey}`;
  // 32px 这类小尺寸画汉字只会糊成一团，只留环
  const word =
    s >= 96
      ? `<text x="${cx}" y="${cy}" font-family=${JSON.stringify(C.font)} font-size="${r * 1.02}" font-weight="700"
    fill="${C.ink}" text-anchor="middle" dominant-baseline="central">饭</text>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="0.3" cy="0.1" r="1.1">
      <stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.arc0}"/><stop offset="1" stop-color="${C.arc1}"/>
    </linearGradient>
  </defs>
  ${bg}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.track}" stroke-width="${w}"/>
  <path d="${arc}" fill="none" stroke="url(#arc)" stroke-width="${w}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy - r}" r="${w * 0.46}" fill="${C.knob}"/>
  ${word}
</svg>`;
}

const page_html = (size, shape) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
   html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}
   svg{display:block}
  </style></head><body>${markup(size, shape)}</body></html>`;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

async function shoot(size, shape, file) {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(page_html(size, shape), { waitUntil: 'load' });
  await page.screenshot({ path: resolve(OUT, file), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(`${file}  ${size}×${size}`);
}

await shoot(192, 'rounded', 'icon-192.png');
await shoot(512, 'rounded', 'icon-512.png');
await shoot(512, 'maskable', 'icon-512-maskable.png');
await shoot(180, 'square', 'apple-touch-icon.png');
await shoot(32, 'rounded', 'favicon-32.png');

await browser.close();
console.log('PWA 图标完成');
