import { useEffect, useRef } from 'react';

/**
 * 数字输入框 —— 重点是「删得干净」。
 *
 * 受控写法都踩坑：
 * 1. `value={n}` + `onChange={Number(e.target.value)}`：删空时 `Number('')` 是 **0**，
 *    于是档案被写成 0；
 * 2. 即使 state 改存字符串草稿，只要还带 `value` 属性，React 在事件结束后发现
 *    DOM 的值和 props 对不上，就会**强制把 props 的值写回去**（controlled input restore）
 *    —— 表现就是最后一位怎么删都弹回来。
 *
 * 所以这里走**非受控**：DOM 的值是唯一真相，React 一个字节都不回写。
 * 只在「外部值真的变了，且用户没在输入」时才同步一次 DOM（取消编辑 / 切档 / 重新加载）。
 */
export function NumInput({
  value,
  onValue,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
}: {
  value: number | null;
  onValue: (v: number | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const focused = useRef(false);

  // 外部值变化 → 同步 DOM；用户正在敲的时候不打断
  useEffect(() => {
    const el = ref.current;
    if (!el || focused.current) return;
    const next = value == null ? '' : String(value);
    if (el.value !== next) el.value = next;
  }, [value]);

  return (
    <input
      ref={ref}
      // 用 number 而不是 text：text + inputMode 在部分中文输入法下会走**组字**（composing），
      // 退格只删输入法自己的缓冲区，DOM 的值不变 —— 表现同样是「删不掉」。
      // number 是原生的数值编辑态，不存在组字，输入法也没法把它变成候选词。
      // 真正的坑一直是 React 回写，非受控已经把它去掉了。
      type="number"
      inputMode="decimal"
      step="any"
      autoComplete="off"
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      defaultValue={value == null ? '' : String(value)}
      onChange={(e) => {
        // 数值型输入框对 "3." / "-" 这类中间态会报 value=""，
        // 这里只把「能解析成数」的结果交给上层，DOM 内容一概不动
        const raw = e.currentTarget.value;
        if (raw === '') {
          onValue(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onValue(n);
      }}
      onFocus={(e) => {
        focused.current = true;
        // 整段选中：改份量基本是重填，一次退格就能清空
        const el = e.currentTarget;
        requestAnimationFrame(() => {
          try {
            el.select();
          } catch {
            /* 忽略 */
          }
        });
      }}
      onBlur={() => {
        focused.current = false;
        // 规范化（"3." → "3"）；删空后离开则兜回上一个有效值
        const el = ref.current;
        if (el) el.value = value == null ? '' : String(value);
      }}
    />
  );
}
