import type { ReactNode } from 'react';

/**
 * 面性图标集（11 枚）。
 *
 * 为什么是内联 SVG 而不是图标字体 / Unicode：
 * 应用跑在安卓 WebView 里（用户那台是鸿蒙 + 卓易通容器），系统字体不保证包含
 * ◎ ◐ ▤ ◔ 这类几何符号 —— 缺字时直接显示成豆腐块。而且这几个符号本来就是同一族
 * 图形，在 98px 高的导航栏里彼此分辨不出来，用户实际是靠位置记忆在导航。
 *
 * 规格：24 网格 / 内切 18（四周各让 3）/ fill=currentColor / 无描边。
 * 面性图标没有"描边加粗"这条退路来表达选中态，所以选中只能靠颜色 —— 见 TabBar。
 *
 * 面性的固有代价：24px 下细节会糊成一团，所以每枚最多留 0~1 个镂空。
 * 想加"三个点""两条热气"这类细节的，先看它在一半尺寸下还看不看得出来。
 */

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 24, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** TabBar · 今日（日历） */
export function IconToday(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        fillRule="evenodd"
        d="M6 4.6h12a3 3 0 0 1 3 3v10.4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7.6a3 3 0 0 1 3-3Zm0 6.3v7.1h12v-7.1H6Z"
      />
      <rect x="7.4" y="2.2" width="2.6" height="4.4" rx="1.3" />
      <rect x="14" y="2.2" width="2.6" height="4.4" rx="1.3" />
    </Svg>
  );
}

/** TabBar · 小助手（对话气泡）。曾经和「午餐」共用 ◐，现在永不复用 */
export function IconChat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.2c5.15 0 9.2 3.3 9.2 7.7s-4.05 7.7-9.2 7.7c-1.05 0-2.07-.13-3.02-.38l-3.62 2.04a.94.94 0 0 1-1.39-1.06l.74-2.6c-1.35-1.4-2.11-3.1-2.11-5.7 0-4.4 4.05-7.7 9.2-7.7Z" />
    </Svg>
  );
}

/** TabBar · 统计（柱状） */
export function IconStats(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.1" y="12.4" width="4.7" height="8.5" rx="1.7" />
      <rect x="9.65" y="6.6" width="4.7" height="14.3" rx="1.7" />
      <rect x="16.2" y="9.6" width="4.7" height="11.3" rx="1.7" />
    </Svg>
  );
}

/** TabBar · 档案（人形） */
export function IconProfile(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="7.5" r="4.2" />
      <path d="M12 13.6c4.5 0 8.1 2.7 8.1 6 0 .9-.72 1.6-1.6 1.6H5.5c-.88 0-1.6-.7-1.6-1.6 0-3.3 3.6-6 8.1-6Z" />
    </Svg>
  );
}

/** FAB · 拍照。用相机不用「+」：导航栏里这个是动作不是导航，符号要说明它干什么 */
export function IconCamera(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        fillRule="evenodd"
        d="M9.1 3.4h5.8l1.35 2.1h2.5A3.25 3.25 0 0 1 22 8.75v9.2A3.25 3.25 0 0 1 18.75 21H5.25A3.25 3.25 0 0 1 2 17.95v-9.2A3.25 3.25 0 0 1 5.25 5.5h2.5L9.1 3.4Zm2.9 6.35a4.55 4.55 0 1 0 0 9.1 4.55 4.55 0 0 0 0-9.1Z"
      />
    </Svg>
  );
}

/** 餐次 · 早餐（日出）。太阳压在地平线后，只露出上半 */
export function IconBreakfast(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="11" r="4.4" />
      <rect x="2.6" y="12.4" width="18.8" height="2.5" rx="1.25" />
      <rect x="4.6" y="17.2" width="6" height="2.3" rx="1.15" />
      <rect x="13.4" y="17.2" width="6" height="2.3" rx="1.15" />
    </Svg>
  );
}

/** 餐次 · 午餐（碗）。碗沿 + 碗身，不画热气 —— 24px 下会糊成一条 */
export function IconLunch(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="8" width="20" height="2.5" rx="1.25" />
      <path d="M3.2 10.8h17.6c0 6.4-3.9 9.9-8.8 9.9s-8.8-3.5-8.8-9.9Z" />
    </Svg>
  );
}

/** 餐次 · 晚餐（月牙） */
export function IconDinner(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.4 15.1A8.7 8.7 0 0 1 8.9 3.6a9.5 9.5 0 1 0 11.5 11.5Z" />
    </Svg>
  );
}

/** 餐次 · 加餐（果实） */
export function IconSnack(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11.7" cy="14.4" r="6.4" />
      <path d="M12.7 7.9c-.2-2.5 1.5-4.7 4.1-5.1.4 2.6-1.4 4.9-4.1 5.1Z" />
    </Svg>
  );
}

/** 本地生成的建议（灯泡）。原来这里是 ◎ —— 和 TabBar「今日」的 ◎ 撞同一个符号 */
export function IconBulb(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.8a6.4 6.4 0 0 0-3.9 11.5c.5.4.8 1 .8 1.6v.5h6.2v-.5c0-.6.3-1.2.8-1.6A6.4 6.4 0 0 0 12 2.8Z" />
      <rect x="9.2" y="17.6" width="5.6" height="2.2" rx="1.1" />
      <rect x="10.2" y="20.6" width="3.6" height="1.8" rx="0.9" />
    </Svg>
  );
}

/** AI 生成的建议（四角星） */
export function IconSpark(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.6l1.95 5.45L19.4 10l-5.45 1.95L12 17.4l-1.95-5.45L4.6 10l5.45-1.95L12 2.6Z" />
      <path d="M18.6 15.2l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85.85-2.35Z" />
    </Svg>
  );
}

/** 编辑（铅笔）。原来这里是 ✎ U+270E —— 同样依赖系统字体 */
export function IconPencil(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17.2 2.6a2.3 2.3 0 0 1 3.2 3.2l-1.3 1.3-3.2-3.2 1.3-1.3Z" />
      <path d="M14.6 5.2l-9.4 9.4-1.2 4.8 4.8-1.2 9.4-9.4-3.6-3.6Z" />
    </Svg>
  );
}

/** 空态 · 时钟（血压区「这段时间还没有记录」）。替换掉字体符号 ◷ */
export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        fillRule="evenodd"
        d="M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2Zm0 2.5a7.1 7.1 0 1 0 0 14.2 7.1 7.1 0 0 0 0-14.2Z"
      />
      <rect x="11.1" y="6.3" width="1.8" height="6.3" rx="0.9" />
      <rect x="12" y="11.1" width="4.6" height="1.8" rx="0.9" />
    </Svg>
  );
}

/** 折叠行箭头（展开时 rotate 180，见 .fold.open .chev） */
export function IconChevron(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11.06 15.44a1.33 1.33 0 0 0 1.88 0l4.6-4.6a1.33 1.33 0 1 0-1.88-1.88L12 12.62 8.34 8.96a1.33 1.33 0 1 0-1.88 1.88l4.6 4.6Z" />
    </Svg>
  );
}

/** 查看原图（四个角括号） */
export function IconExpand(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        fillRule="evenodd"
        d="M3 3h7v2.6H5.6V10H3V3Zm11 0h7v7h-2.6V5.6H14V3ZM3 14h2.6v4.4H10V21H3v-7Zm15.4 0H21v7h-7v-2.6h4.4V14Z"
      />
    </Svg>
  );
}
