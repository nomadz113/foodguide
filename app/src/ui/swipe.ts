import { useRef } from 'react';
import type { TouchEvent } from 'react';

/**
 * 横向滑动切换分区（统计页「饮食 / 血压」）。
 *
 * 三条硬约束，任何一条破了就会和页面滚动打架：
 *
 * 1. **必须先判定主轴再决定去留**。手指在屏幕上几乎不可能只走一个方向：
 *    纵向滚动时横向分量常有 20~30px，反过来也一样。所以 TouchMove 一开始
 *    只观察不动手，`|dx|` 明显大于 `|dy|` 才锁定为横向；一旦纵向赢了，
 *    本次手势直接作废（`axis: 'y'`），后续 move 一律不看。锁定之后不再改判 ——
 *    否则会滑到一半又从横向翻成纵向，页面滚了一半又切了个分区。
 * 2. **位移要够、时间要短**。`MIN_DX` 以下算手指抖动；拖了 1 秒以上是「慢慢挪」，
 *    那时用户多半是在翻内容，不是在切换。
 * 3. **不 preventDefault**。滚动交给浏览器，CSS 侧用 `touch-action: pan-y`
 *    告诉它「横向归我、纵向归你」。手动 preventDefault 会在部分 WebView 上
 *    把整页滚动一起锁死。
 */

/** 触发切换所需的最小水平位移（px） */
const MIN_DX = 48;
/** 判定主轴所需的最小位移：低于它在两轴上都还看不出意图 */
const DECIDE_DX = 12;
/** 横向分量必须比纵向大这么多倍，才认为用户想横滑而不是在滚动 */
const AXIS_RATIO = 1.4;
/** 手势总时长上限，超过就算拖动查看 */
const MAX_MS = 800;
/** 松手时的纵向漂移上限，超过说明这是一次斜着的滚动 */
const MAX_DY = 46;

interface Track {
  x: number;
  y: number;
  t: number;
  axis: 'x' | 'y' | null;
}

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
  onTouchCancel: () => void;
}

/**
 * @param onPrev 手指向右滑（dx > 0）—— 回到上一个分区
 * @param onNext 手指向左滑（dx < 0）—— 进入下一个分区
 */
export function useSwipeTab(onPrev: () => void, onNext: () => void): SwipeHandlers {
  const track = useRef<Track | null>(null);

  return {
    onTouchStart(e) {
      // 双指以上（缩放、双指滑动）直接不管
      if (e.touches.length !== 1) { track.current = null; return; }
      const t = e.touches[0];
      if (!t) return;
      track.current = { x: t.clientX, y: t.clientY, t: Date.now(), axis: null };
    },

    onTouchMove(e) {
      const s = track.current;
      if (!s || s.axis) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) >= DECIDE_DX && Math.abs(dx) > Math.abs(dy) * AXIS_RATIO) {
        s.axis = 'x';
      } else if (Math.abs(dy) >= DECIDE_DX) {
        s.axis = 'y';
      }
    },

    onTouchEnd(e) {
      const s = track.current;
      track.current = null;
      if (!s || s.axis !== 'x') return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < MIN_DX || Math.abs(dy) > MAX_DY) return;
      if (Date.now() - s.t > MAX_MS) return;
      if (dx > 0) onPrev();
      else onNext();
    },

    onTouchCancel() {
      track.current = null;
    },
  };
}
