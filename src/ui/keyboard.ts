import { useSyncExternalStore } from 'react';

/**
 * 软键盘让位。
 *
 * 现象：点输入框 → 键盘升起 → 输入条被压在键盘下面，看不见自己打了什么字。
 * 原因：`.app` 是 `height: 100dvh` 的固定高度壳，而**布局视口在键盘升起时并不变小**
 * （Android WebView / iOS Safari 默认只压「可视视口」，layout viewport 保持全屏高）。
 * 于是底部那截被键盘盖住，页面却仍然按全屏高排版。
 *
 * 做法：算出「布局视口比可视视口多出来的那一截」，把它从 `.app` 的高度里减掉，
 * 整个 flex 壳随之收缩，输入条自然停在键盘上沿 —— 这就是「整体上移」。
 *
 * ⚠️ 这里有个必须守住的边界：**不能和系统的挤压重复计算。**
 * 若原生 `windowSoftInputMode=adjustResize` 或 viewport 的
 * `interactive-widget=resizes-content` 已经生效，`window.innerHeight` 本身就是缩小后的值，
 * 此时 `布局高 - 可视高 ≈ 0`，本模块必须算出 0 并什么都不做。
 * 否则「系统压一次 + 我们再减一次」会让界面整体上移两倍键盘高度。
 * 三层兜底（manifest / meta / JS）之所以能共存，靠的就是这个自适应的差值公式。
 */

/** 小于这个高度不算键盘：地址栏收放、滚动回弹都会让视口抖几个到几十像素 */
const MIN_KEYBOARD = 40;

/**
 * 纯函数，便于单测。
 * @param visualHeight   visualViewport.height
 * @param visualOffsetTop visualViewport.offsetTop（可视区相对布局区顶部的偏移）
 * @param layoutHeight   window.innerHeight
 */
export function computeKeyboardInset(
  visualHeight: number,
  visualOffsetTop: number,
  layoutHeight: number,
): number {
  const raw = layoutHeight - (visualHeight + visualOffsetTop);
  return raw > MIN_KEYBOARD ? Math.round(raw) : 0;
}

let inset = 0;
let appH = 0;
const subs = new Set<() => void>();
let cleanup: (() => void) | null = null;
let focusTimer = 0;

function read() {
  const vv = window.visualViewport;
  const layoutH = window.innerHeight;
  if (!vv) return { kb: 0, appH: layoutH };
  const kb = computeKeyboardInset(vv.height, vv.offsetTop, layoutH);
  return { kb, appH: layoutH - kb };
}

function sync() {
  const next = read();
  if (next.kb === inset && next.appH === appH) return;
  inset = next.kb;
  appH = next.appH;
  const root = document.documentElement;
  // 高度直接给像素值，不依赖 dvh 对键盘的响应差异（各 WebView 实现不一致）
  root.style.setProperty('--app-h', `${appH}px`);
  root.style.setProperty('--kb', `${inset}px`);
  root.classList.toggle('kb-open', inset > 0);
  for (const fn of subs) fn();
}

/**
 * 输入框落在可滚动内容区里时（卡片里的数字框、编辑页的食物名），
 * 键盘升起后它仍可能被压在下面 —— 键盘动画结束再把它滚到中间。
 */
function onFocusIn(e: FocusEvent) {
  const el = e.target as HTMLElement | null;
  if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  // 吸底的输入条不用滚：它在 flex 布局里本来就贴着底部，键盘升起后随壳一起上移。
  // 滚它反而会把刚上移好的布局又推歪。
  if (el.closest('.composer, .totalbar, .tabbar, .sheetbar')) return;
  window.clearTimeout(focusTimer);
  focusTimer = window.setTimeout(() => {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 350);
}

/** 启动监听（幂等）。返回取消函数。 */
export function watchKeyboard(): () => void {
  if (cleanup) return cleanup;
  sync();

  const vv = window.visualViewport;
  window.addEventListener('resize', sync);
  vv?.addEventListener('resize', sync);
  vv?.addEventListener('scroll', sync);
  document.addEventListener('focusin', onFocusIn);

  cleanup = () => {
    window.removeEventListener('resize', sync);
    vv?.removeEventListener('resize', sync);
    vv?.removeEventListener('scroll', sync);
    document.removeEventListener('focusin', onFocusIn);
    window.clearTimeout(focusTimer);
    cleanup = null;
  };
  return cleanup;
}

function subscribe(fn: () => void) {
  watchKeyboard();
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

const getSnapshot = () => inset;
const getServerSnapshot = () => 0;

/**
 * 当前键盘高度（px）。键盘未弹起时为 0。
 * 典型用法：聊天页在它变化时滚到底 —— 壳收缩后，最后一条消息会掉到可视区外。
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
