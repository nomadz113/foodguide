/**
 * PWA 部署前验收：Service Worker、离线启动、子路径部署。
 *
 * 三件事必须都过，否则"发到网上"会变成"发到网上一断网就白屏"：
 * 1. SW 注册并接管（controlling 为 true）
 * 2. 断网后 reload 仍能渲染（NetworkFirst 的兜底真的走到了 index.html）
 * 3. 部署在子路径（/p/xxx/）时资源还能解析（base: './' 的意义）
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '../dist');
const PREFIX = '/p/demo';
const PORT = 4188;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 同时把 dist 挂在 /（根部署）和 /p/demo/（子路径部署） */
const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || '/';
  if (path.endsWith('/')) path += 'index.html';

  const file = join(DIST, path);
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

const results = [];

async function check(label, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  page.on('requestfailed', (r) => errors.push(`FAILED ${r.url().slice(0, 120)}`));

  await page.goto(url, { waitUntil: 'networkidle2' });

  // 等 SW 接管
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return {
      supported: true,
      scope: reg?.scope ?? null,
      controller: Boolean(navigator.serviceWorker.controller),
      manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null,
      icons: performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('icon-'))
        .length,
    };
  });

  // 首屏是否真的渲染了
  const rendered = await page.evaluate(() => document.querySelectorAll('.app').length > 0);

  // 断网 + 重载
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  const offlineRendered = await page
    .evaluate(() => document.querySelectorAll('.app').length > 0)
    .catch(() => false);
  const offlineTitle = await page.evaluate(() => document.querySelector('h1')?.textContent ?? '').catch(() => '');

  results.push({ label, url, sw, rendered, offlineRendered, offlineTitle, errors: errors.slice(0, 3) });
  await page.close();
}

await check('根路径部署', `http://localhost:${PORT}/`);
await check('子路径部署', `http://localhost:${PORT}${PREFIX}/`);

await browser.close();
server.close();

for (const r of results) {
  console.log(`\n── ${r.label}  ${r.url}`);
  console.log(`   SW 注册: ${r.sw.supported}  接管: ${r.sw.controller}  scope: ${r.sw.scope}`);
  console.log(`   manifest: ${r.sw.manifest}`);
  console.log(`   首屏渲染: ${r.rendered}   断网后渲染: ${r.offlineRendered} (${r.offlineTitle || '无标题'})`);
  if (r.errors.length) console.log(`   错误: ${r.errors.join(' | ')}`);
}

const ok = results.every((r) => r.rendered && r.offlineRendered && r.sw.controller);
console.log(`\n结果: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
