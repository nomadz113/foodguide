/**
 * Service Worker —— PWA 的三条策略，写错任何一条都会白屏。
 *
 *   index.html / 导航请求    NetworkFirst（3s 超时）  ← 保证能拿到新版本入口
 *   同源静态资源             CacheFirst              ← 首屏快
 *   AI 接口域名              NetworkOnly（显式）     ← 绝不能落到 index.html
 *
 * 为什么 AI 那条必须显式写：离线时若让 AI 请求命中缓存的 index.html，
 * `res.json()` 会抛 `Unexpected token '<'`，报错信息完全指不到真正原因。
 *
 * 更新策略是不自动 skipWaiting：用户可能正把份量调到一半，
 * 整页刷新会把草稿全丢掉。新版本等在 waiting，由页面上的提示让用户自己点。
 */
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const NETWORK_TIMEOUT = 3000;

const AI_HOSTS = ['dashscope.aliyuncs.com', 'aliyuncs.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) =>
      // 相对路径：站点可能部署在子路径下（/p/xxx/），不能写死 '/index.html'
      c.addAll(['./', './index.html', './manifest.webmanifest', './icon-192.png']),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ① AI 接口：只走网络，不缓存、不回退
  if (AI_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    event.respondWith(fetch(req));
    return;
  }

  if (url.origin !== self.location.origin) return;
  // SW 自身永远走网络，否则更新会卡死在旧版本
  if (url.pathname.endsWith('/sw.js')) return;

  const isDocument = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  event.respondWith(isDocument ? networkFirst(req) : cacheFirst(req));
});

function withTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    // no-store：入口 HTML 必须绕过 HTTP 缓存。托管侧没给 Cache-Control，
    // 浏览器会按 Last-Modified 做启发式缓存 —— 那就是「发了新版、手机上还是旧界面」
    // 最常见的原因，而且现象和「代码没生效」完全一样。
    fetch(request, { cache: 'no-store' }).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  // 路由是 hash 的，任何入口都能用同一个外壳起来
  const shell = async () =>
    (await cache.match(request)) || (await cache.match('./index.html')) || (await cache.match('./'));
  try {
    const fresh = await withTimeout(request, NETWORK_TIMEOUT);
    if (fresh && fresh.ok) {
      await cache.put(request, fresh.clone());
      return fresh;
    }
    // 网络是通的，但网关挡了回来（4xx/5xx）：典型是托管侧的访问凭证过期返回 403。
    // 这时 fetch 不会 throw，只会拿到一张空白错误页——有缓存就用缓存顶上，
    // 数据全在 IndexedDB 里，用户至少还能记一餐。
    if (fresh) return (await shell()) || fresh;
    return fresh;
  } catch {
    // 超时或离线
    const cached = await shell();
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  // 只缓存同源、成功、非 opaque 的响应
  if (res && res.ok && res.type === 'basic') await cache.put(request, res.clone());
  return res;
}
