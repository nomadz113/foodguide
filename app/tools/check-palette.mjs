/**
 * 色板静态自检：不启浏览器，直接解析 index.css 的两套变量并算 WCAG 对比度。
 *
 * 为什么单独做：check-theme.mjs 要起 Edge、跑一遍页面，慢；改一次色板跑一次浏览器
 * 反馈太慢。这个脚本是秒级反馈，改完色板先跑它。
 *
 * 判据、PAIRS、豁免理由全部在 tools/lib/palette.mjs —— **这里不写第二份**。
 * check-theme.mjs 也 import 同一个 lib，只是把「变量从哪来」换成真浏览器的
 * getComputedStyle(:root)：口径一致，被测对象不同（字面量 vs 浏览器解析结果）。
 *
 * 两者都会查的就是「第二层底色」那类组合：--mute 画在 --card2 上、--ok-fg 画在
 * --ok-bg 上，肉眼看着还行，实际只有 3 点几比 1，小字直接糊掉。
 *
 * 用法：node tools/check-palette.mjs [--css src/index.css] [--json]
 * 退出码 1 = 有组合不达标。
 */
import { readPaletteFromCss, check, printRows } from './lib/palette.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const CSS_PATH = arg('--css', 'src/index.css');
const AS_JSON = argv.includes('--json');

const { dark, light } = readPaletteFromCss(CSS_PATH);

const out = { dark: check('dark', dark), light: check('light', light) };

if (AS_JSON) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const bad = printRows(out);
  console.log(bad ? `\n不达标 ${bad} 处` : '\n全部通过');
  process.exit(bad ? 1 : 0);
}
