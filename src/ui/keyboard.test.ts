import { describe, expect, it } from 'vitest';
import { computeKeyboardInset } from './keyboard';

/**
 * 这些用例守的不是「算得对不对」，而是**别多减**。
 * 让位是三层兜底（manifest adjustResize / viewport meta / 本模块），
 * 只要前面任意一层已经把布局压好了，这里就必须算出 0。
 */
describe('computeKeyboardInset', () => {
  it('没有键盘时是 0', () => {
    expect(computeKeyboardInset(800, 0, 800)).toBe(0);
  });

  it('键盘吃掉多少就报多少', () => {
    // 布局 800，可视只剩 500 → 底部 300 被盖住
    expect(computeKeyboardInset(500, 0, 800)).toBe(300);
  });

  it('系统已经把布局压好了就不再让位（关键：不能重复上移）', () => {
    // adjustResize 生效后 window.innerHeight 本身就是 500
    expect(computeKeyboardInset(500, 0, 500)).toBe(0);
  });

  it('视口抖动几十像素不算键盘（阈值 40）', () => {
    expect(computeKeyboardInset(782, 0, 800)).toBe(0);
    expect(computeKeyboardInset(761, 0, 800)).toBe(0);
    expect(computeKeyboardInset(759, 0, 800)).toBe(41);
  });

  it('页面滚动过的偏移量要参与计算', () => {
    // 可视区 [100, 500]，被盖住的是 [500, 800]，还是 300
    expect(computeKeyboardInset(400, 100, 800)).toBe(300);
    // 可视区顶到 [300, 800]：被盖的是**顶部**不是底部，不该让位
    expect(computeKeyboardInset(500, 300, 800)).toBe(0);
  });
});
