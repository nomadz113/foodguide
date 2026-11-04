/**
 * 把构建戳写进 dist/sw.js 的 VERSION 常量，并把**本次构建的首屏资源**注入 SHELL_FILES。
 *
 * 为什么必须有这一步：sw.js 放在 public/ 下，Vite **原样拷贝、不参与编译**，
 * 也**不经过 define**，所以它的字节永远不变。而浏览器判断「有没有新版」的唯一
 * 依据就是 sw.js 的字节有没有变化 —— 不变就永远不触发 updatefound，
 * 于是页面上那个「有新版本」提示条（src/pwa.ts + App.tsx）永远不会亮。
 *
 * 表现：发了新版，手机上还是旧界面，重启多少次都没用；连提示都看不到。
 *
 * 为什么做成独立脚本而不是 vite 插件钩子：Vite 拷贝 public/ 的时机与插件钩子
 * 的先后没有保证（writeBundle 阶段 dist/sw.js 可能还不存在）。放在 vite build
 * 之后单独跑，顺序是确定的。
 *
 * 幂等：正则匹配任意已有值，而不是只匹配最初的 'v2'，否则第二次构建就会失灵。
 *
 * ── 为什么还要注入 SHELL_FILES（0.9.7 起）──
 * 原来清单只有 `./ ./index.html ./icon-192.png`，JS 与 CSS 全靠运行时 CacheFirst
 * 机会性缓存。后果：发了新版，NetworkFirst 拿到新 index.html，里面引用的
 * 新 hash 资源一个都没缓存 —— 全部现场下载。而在线 wb 版的 APK（capacitor.config.wb.json
 * 的 server.url 指向托管站）**每次冷启动都要走这条路**。所以清单必须由构建产物生成，
 * 而不是写死。这也是为什么文件名从 dist/index.html 里读：只有它知道这次的 hash。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = resolve(root, 'dist/sw.js');
const htmlPath = resolve(root, 'dist/index.html');

const gradle = readFileSync(resolve(root, 'android/app/build.gradle'), 'utf8');
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? 'dev';
const d = new Date();
const two = (n) => String(n).padStart(2, '0');
// 这个戳同时会变成 cache 名（SHELL = `shell-${VERSION}`），所以必须用纯 ASCII：
// 万一 caches.open() 在含空格/中文标点（这里是 '·'）的名字上出问题，
// fetch 处理会整体失败 —— 那比原来的 bug 严重得多（直接白屏）。
// 精确到秒：戳只到分钟的话，同一分钟内连发两次 sw.js 字节会相同，更新又检测不到。
const stamp = [
  versionName,
  `${two(d.getMonth() + 1)}${two(d.getDate())}`,
  `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`,
].join('-');

if (!existsSync(swPath)) {
  console.error(`[stamp-sw] 找不到 ${swPath}，构建产物不完整，拒绝静默跳过`);
  process.exit(1);
}
if (!existsSync(htmlPath)) {
  console.error(`[stamp-sw] 找不到 ${htmlPath}，无法生成预缓存清单，拒绝静默跳过`);
  process.exit(1);
}

/**
 * 首屏资源的相对路径清单，从 index.html 里读。
 *
 * 三条踩过的坑：
 * 1. **必须是相对路径**（'./assets/x.js'）。站点可能部署在子路径 /p/xxx/ 下，
 *    写死 '/assets/x.js' 会 404，而且是静默 404（c.add 失败被 catch 掉）。
 * 2. 只认 `<script src>` / `<link rel=modulepreload>` / `<link rel=stylesheet>`。
 *    manifest 不进清单：托管环境对不带凭证的子资源一律 403，一个装饰性配置
 *    不该有能力让整个 SW 装不上。
 * 3. 外部 URL / data: URI 一律跳过 —— 跨域资源进 SW 缓存只会长期占空间。
 */
function readShellAssets(html) {
  const out = new Set();
  const add = (href) => {
    if (!href) return;
    if (/^(?:[a-z]+:)?\/\//i.test(href) || /^data:/i.test(href) || href.startsWith('#')) return;
    // 统一成 './xxx'，与现有条目同一种写法（SW 在站点根，index.html 也在站点根，
    // 所以同一个字符串在两边解析结果一致）
    out.add(href.startsWith('./') ? href : `./${href.replace(/^\/+/, '')}`);
  };

  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1];
    // 只看 type="module" 的入口脚本；内联脚本没有 src
    if (!/\btype\s*=\s*["']module["']/i.test(attrs)) continue;
    add(/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
  }

  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? '';
    if (!/\b(modulepreload|stylesheet)\b/.test(rel)) continue;
    add(/\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
  }

  return [...out];
}

const html = readFileSync(htmlPath, 'utf8');
const assets = readShellAssets(html);
if (assets.length === 0) {
  // 不 exit(1)：清单为空只是退回改造前的行为（运行时机会性缓存），不是故障。
  // 但必须喊出来，否则「预缓存没生效」会完全没有线索。
  console.warn('[stamp-sw] index.html 里没解析到任何首屏资源，SHELL_FILES 只有外壳三件套');
}

// 外壳三件套保持原顺序与写法（'./' 与 './index.html' 是 networkFirst 的回退目标）
const shellFiles = ['./', './index.html', './icon-192.png', ...assets].filter(
  (v, i, arr) => arr.indexOf(v) === i,
);

const src = readFileSync(swPath, 'utf8');

const VERSION_RE = /const VERSION = '[^']*';/;
if (!VERSION_RE.test(src)) {
  console.error("[stamp-sw] dist/sw.js 里没找到 `const VERSION = '...';`，拒绝静默跳过");
  process.exit(1);
}

const SHELL_RE = /const SHELL_FILES = \[[\s\S]*?\];/;
if (!SHELL_RE.test(src)) {
  console.error('[stamp-sw] dist/sw.js 里没找到 `const SHELL_FILES = [...];`，拒绝静默跳过');
  process.exit(1);
}

const next = src
  .replace(VERSION_RE, `const VERSION = ${JSON.stringify(stamp)};`)
  // 单行输出：这份数组是构建产物，不需要给人读的缩进（原文件里有注释解释为什么这么写）
  .replace(SHELL_RE, `const SHELL_FILES = ${JSON.stringify(shellFiles)};`);

writeFileSync(swPath, next);
console.log(`[stamp-sw] VERSION = ${stamp}`);
console.log(`[stamp-sw] SHELL_FILES 预缓存 ${shellFiles.length} 项：${assets.join(' ')}`);

