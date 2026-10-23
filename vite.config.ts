import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** 构建戳：设置页里显示，用来分辨设备上跑的是哪一版（wb 版页面来自线上站，最容易看错版本） */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const versionName = /versionName\s+"([^"]+)"/.exec(read('./android/app/build.gradle'))?.[1] ?? 'dev';
const d = new Date();
const two = (n: number) => String(n).padStart(2, '0');
const stamp = `${versionName} · ${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

export default defineConfig({
  plugins: [react()],
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
