/**
 * 生成 PWA 图标（public/ 下，随构建复制到 dist）。
 *
 * - icon-192 / icon-512：圆角方形，浏览器与安卓主屏用
 * - icon-512-maskable：满版底色 + 内容收到 46%，给安卓自适应裁切留安全区
 * - apple-touch-icon-180：满版方形（iOS 自己套圆角，不能预先裁）
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public');
mkdirSync(OUT, { recursive: true });

/** shape: rounded | square | maskable */
function markup(size, shape) {
  const s = size;
  const radius = shape === 'rounded' ? s * 0.22 : 0;
  const ringScale = shape === 'maskable' ? 0.46 : 0.62;

  const bg =
    shape === 'rounded'
      ? `<rect width="${s}" height="${s}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>`
      : `<rect width="${s}" height="${s}" fill="url(#bg)"/>`;

  const cx = s / 2;
  const cy = s / 2;
  const r = (s * ringScale) / 2;
  const w = Math.max(2, s * 0.075);
  const sweep = 0.68;
  const a = -Math.PI / 2 + sweep * Math.PI * 2;
  const ex = cx + r * Math.cos(a);
  const ey = cy + r * Math.sin(a);
  const arc = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${ex} ${ey}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="0.3" cy="0.1" r="1.1">
      <stop offset="0" stop-color="#16211b"/><stop offset="1" stop-color="#0b0e13"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#86efac"/><stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  ${bg}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1d2a22" stroke-width="${w}"/>
  <path d="${arc}" fill="none" stroke="url(#arc)" stroke-width="${w}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy - r}" r="${w * 0.42}" fill="#0b0e13"/>
</svg>`;
}

const page_html = (size, shape) =>
  `<!DOCTYPE html><html><head><style>
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
