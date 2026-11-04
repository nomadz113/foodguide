/**
 * 从 .env.local 读密钥（不引依赖），供验证脚本使用。
 * 生产环境由云函数环境变量注入，前端永不接触这个文件。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const appRoot = resolve(here, '..');

export function loadEnv(file = resolve(appRoot, '.env.local')) {
  const env = {};
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}
