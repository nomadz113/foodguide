import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// 带 .ts 扩展名：Vite 8 用 Node 原生加载配置文件，无扩展名的相对 import 会告警
// （Node 22.18+ 自带类型擦除，所以 .ts 能被直接解析）。tsconfig 里
// allowImportingTsExtensions 已打开。
import { criticalCssPlugin, asyncStylesheetPlugin } from './tools/critical-css.ts';

/** 构建戳：设置页里显示，用来分辨设备上跑的是哪一版（wb 版页面来自线上站，最容易看错版本） */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const versionName = /versionName\s+"([^"]+)"/.exec(read('./android/app/build.gradle'))?.[1] ?? 'dev';
const d = new Date();
const two = (n: number) => String(n).padStart(2, '0');
const stamp = `${versionName} · ${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

export default defineConfig({
  plugins: [
    react(),
    // 首帧关键 CSS：从 src/index.css 抽 :root 变量 + 外壳规则内联进 index.html。
    // 只读取，不改写；唯一真源仍是 src/index.css（见 tools/critical-css.ts）。
    criticalCssPlugin(fileURLToPath(new URL('.', import.meta.url))),
    // 外链 CSS 改成非渲染阻塞（media=print + onload 换回 all）+ <noscript> 兜底。
    // 不做这一步，内联的关键 CSS 等于白搭：浏览器仍要等整份 CSS 到齐才首绘。
    asyncStylesheetPlugin(),
  ],
  // 相对路径：站点可能部署在子路径（/p/xxx/）下，也兼容 Capacitor 的
  // https://localhost 根路径。路由是 hash 的，文档 URL 不随页面变化，
  // 所以相对路径不会因为切换页面而解析错位。
  base: './',
  server: { host: true, port: 5173 },
  define: { __BUILD__: JSON.stringify(stamp) },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
