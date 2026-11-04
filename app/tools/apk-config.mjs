/**
 * 决定这一个 APK 到底「从哪加载页面」。
 *
 *   node tools/apk-config.mjs offline   # 内嵌 dist，完全离线（origin https://localhost）
 *   node tools/apk-config.mjs wb        # 加载 WorkBuddy 托管版（自带 sharecode，没有访问提示中间页）
 *
 * assets/capacitor.config.json 是 **cap sync 每次重新生成**的，
 * 而 `cap sync` 不接受 --config 参数，所以只能在 sync 之后、Gradle 打包之前改这个文件。
 * 每个模式都要跑一遍，避免上一次的 server.url 残留到离线包里。
 *
 * 在线版（wb）的取舍：
 * 1) **不写 server.errorPath**。Capacitor 的 BridgeWebViewClient 在
 *    onReceivedHttpError（主框架 4xx/5xx）时也会 loadUrl(errorPath)，
 *    配了 errorPath，托管站的错误响应会被本地错误页顶掉。
 * 2) **server.url 的路径部分必须以 / 结尾**。Capacitor 直接把它当 appUrl 用，
 *    不带斜杠时相对路径会拼到错误层级。注意是 pathname 而不是整个字符串——
 *    WorkBuddy 托管那份 URL 带 `?sharecode=`，它必须以斜杠结尾的 path 打头。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(APP, 'android/app/src/main/assets/capacitor.config.json');
// 在线模式只剩 WorkBuddy 托管（自带 sharecode，没有访问提示中间页）
const SOURCES = {
  wb: resolve(APP, 'capacitor.config.wb.json'),
};

const mode = process.argv[2];
if (mode !== 'offline' && !SOURCES[mode]) {
  console.error('用法: node tools/apk-config.mjs offline|wb');
  process.exit(1);
}

if (!existsSync(TARGET)) {
  console.error(`✗ 找不到 ${TARGET}，先跑 npx cap sync android`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(TARGET, 'utf8'));

if (mode !== 'offline') {
  const src = JSON.parse(readFileSync(SOURCES[mode], 'utf8'));
  const url = src?.server?.url;
  if (!url) {
    console.error(`✗ ${SOURCES[mode]} 里没有 server.url`);
    process.exit(1);
  }
  // 用 URL 解析后再判：带 query 的 URL 字符串本身不以 / 结尾是正常的
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith('/')) {
    console.error(`✗ server.url 的路径必须以 / 结尾，当前是 ${parsed.pathname}`);
    process.exit(1);
  }
  cfg.server = { ...(cfg.server || {}), ...src.server };
  delete cfg.server.errorPath;
  console.log(`▸ 模式 ${mode}：由 ${cfg.server.url} 提供页面`);
} else {
  if (cfg.server) {
    delete cfg.server.url;
    delete cfg.server.errorPath;
    if (Object.keys(cfg.server).length === 0) delete cfg.server;
  }
  console.log('▸ 模式 offline：由内嵌 assets 提供页面');
}

writeFileSync(TARGET, JSON.stringify(cfg, null, 2) + '\n');
