/**
 * 主题：跟随系统（prefers-color-scheme），可选强制浅/深。
 *
 * 两个入口，缺一不可：
 * 1. `BOOTSTRAP`（index.html 内联脚本）在 CSS 生效**之前**把 data-theme 写到 <html>。
 *    没有它，深色用户每一帧启动都会先闪一下白——CSS 加载完成前 body 是浏览器默认的白底。
 *    那段脚本内联在 HTML 里，因为它不能等任何网络请求。
 * 2. 本模块负责运行期：安装和 Settings.theme 变化时重算，并挂 matchMedia 实时跟随系统。
 *    它比引导脚本更权威（能读到 Dexie），所以启动后由它接管。
 *
 * 偏好镜像写 localStorage：引导脚本读不了 IndexedDB（异步，且首个 cold start 时库还没建好），
 * localStorage 是唯一能在首帧前同步拿到的地方。
 */

import type { ThemeMode } from '../core/db/types';

// 类型定义在 core/db/types（Settings.theme 用它），这里只是转出来给 UI 用：
// 两边必须是同一个定义，否则加一档就要改两个地方
export type { ThemeMode };

export const THEME_MIRROR_KEY = 'app.theme';

const THEMES: ThemeMode[] = ['system', 'light', 'dark'];

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (THEMES as string[]).includes(v);
}

/** matches 为 null 表示浏览器不支持该查询（极老的 WebView）→ 一律按浅色兜底 */
function systemPrefersDark(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemPrefersDark() ? 'dark' : 'light';
}

/** 把 ThemeMode 落到 <html data-theme>，并同步所有依赖它的原生/Web 表现 */
export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);

  syncThemeColorMeta(resolved);
  syncStatusBarStyle(resolved);

  try {
    localStorage.setItem(THEME_MIRROR_KEY, mode);
  } catch {
    // 隐私模式下 localStorage 会抛；丢这只是下次启动先用首帧兜底色，不影响使用
  }
  return resolved;
}

/** <meta name="theme-color">：安卓用它给状态栏和任务卡片染色，必须给**实际生效**的那一版 */
function syncThemeColorMeta(resolved: 'light' | 'dark') {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0b0e13' : '#f4f6fa';
}

/**
 * iOS 主屏模式下 apple-mobile-web-app-status-bar-style 决定状态栏文字颜色。
 * black-translucent = 白字，画在浅色背景上等于隐形 —— 必须跟着主题切。
 */
function syncStatusBarStyle(resolved: 'light' | 'dark') {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
  );
  if (meta) meta.content = resolved === 'dark' ? 'black-translucent' : 'default';
}

/**
 * 挂上系统监听 + 读持久化偏好，返回清理函数。
 *
 * mode 由调用方（AppDataProvider）从 Settings 里读出来给进来；这里不直接读 Dexie，
 * 是为了能在纯 Web/bootstrapping 阶段先跑起来，也便于单测。
 */
export function watchTheme(mode: ThemeMode): () => void {
  applyTheme(mode);
  if (typeof window.matchMedia !== 'function') return () => {};

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  // addEventListener 在旧 WebKit 上没有，只有 addListener
  const onChange = () => applyTheme(mode);
  if (mq.addEventListener) {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}

/** 引导脚本用：同步读出上次的选择（只能读 localStorage，读不了 IndexedDB） */
export function readMirroredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_MIRROR_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}
