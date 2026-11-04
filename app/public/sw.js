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
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const NETWORK_TIMEOUT = 3000;

const AI_HOSTS = ['dashscope.aliyuncs.com', 'aliyuncs.com'];

/**
 * 外壳清单。
 *
 * **这份数组是构建产物的一部分**：`tools/stamp-sw.mjs` 在 `vite build` 之后
 * 解析 `dist/index.html`，把 `<script src>` / `<link rel=modulepreload>` /
 * `<link rel=stylesheet>` 指向的文件（也就是本次构建的 hash）追加进来。
 * 所以千万不要在浏览器里手动调这一行 —— 下次构建就会被覆盖回去。
 * 想在清单里加东西，改 stamp-sw.mjs。
 *
 * 为什么必须是构建期注入：hash 每次构建都变。写死等于每次发版后，
 * NetworkFirst 拿到新 index.html，而它引用的新资源一个都不在缓存里 ——
 * 全部现场下载。在线 wb 版的 APK（server.url 指向托管站）每次冷启动都走这条路。
 *
 * 刻意用逐个 add 而不是 addAll：addAll 是原子的，里面任何一个 404/403 都会让
 * **整个 SW 装不上**，后果是长年没有 controller —— 断网后能打开只是 HTTP 缓存在顶，
 * 一旦缓存过期就是白屏，而且这类故障不会报错，看不出来。
 * 清单变长之后这一条更重要了：十几项里只要一项挂掉，addAll 就全废。
 *
 * 清单里也不放 manifest：它由 <link rel="manifest"> 单独拉取，浏览器自己管；
 * 而托管环境对不带凭证的子资源一律 403（?sharecode 只作用于 HTML），
 * 一个装饰性的配置文件不该有能力关掉整个离线能力。
 */
const SHELL_FILES = ['./', './index.html', './icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) =>
      // 相对路径：站点可能部署在子路径下（/p/xxx/），不能写死 '/index.html'
      Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => null))),
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
  // ① 先查预缓存（SHELL）。install 阶段灌进去的首屏 JS/CSS 在这里命中 ——
  //    这是「装完就有、断网也有」的那一层，也是版本更新后不再现场下载的原因。
  //    原来只查 RUNTIME，于是 SHELL_FILES 里放什么都没用（除了导航回退）。
  const shell = await caches.open(SHELL);
  const pre = await shell.match(request);
  if (pre) return pre;

  // ② 再查运行时缓存（懒加载页面、图片等机会性缓存的东西）
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  // 只缓存同源、成功、非 opaque 的响应
  if (res && res.ok && res.type === 'basic') await cache.put(request, res.clone());
  return res;
}
