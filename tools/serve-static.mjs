/**
 * 极简静态服务器（开发辅助）：把项目根目录挂出来，给 promo 页面取图用。
 *
 * 为什么不用 vite preview：promo/index.html 引用的是 ../shots/*.png 与
 * ../app/promo/shots/*.png —— 都在项目根下，不在 dist 里。
 *
 * 用法：node tools/serve-static.mjs [port] [root]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] ?? 4300);
const ROOT = resolve(process.argv[3] ?? join(fileURLToPath(import.meta.url), '../..'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let p = normalize(join(ROOT, url === '/' ? '/promo/index.html' : url));
    if (!p.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(p).catch(() => null);
    if (info?.isDirectory()) p = join(p, 'index.html');
    const buf = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p).toLowerCase()] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`静态服务: http://127.0.0.1:${PORT}/  root=${ROOT}`);
});
