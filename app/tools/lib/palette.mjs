/**
 * 色板判据的唯一真源（单一口径）。
 *
 * 为什么抽成 lib：同一份判据现在有两个消费者，取值方式却根本不同 ——
 *   · check-palette.mjs  —— 静态：解析 src/index.css 的变量字面量，秒级，改色板时先跑它；
 *   · check-theme.mjs    —— 动态：从真浏览器的 getComputedStyle(:root) 取变量，
 *                           验「浏览器到底解析成了什么」。
 * 如果两边各抄一份 PAIRS，色板加一层底色时必然只改一处，另一处从此静默地少检 ——
 * 这正是 check-*.mjs 历史上出过的事（exit 0，但量的是引导页）。
 *
 * 所以：**PAIRS / THRESH / EXEMPT / check() 只在这里存在一份**。
 * 两个脚本拿到的只是「变量名 → 值」的 Map，来源自便。
 *
 * 判据：
 *   text  4.5:1   —— 正文 / 12px 说明文字
 *   large 3.0:1   —— ≥18.66px 粗体或 ≥24px 的数值
 *   ui    3.0:1   —— 图形、进度轨道、描边等「承载状态」的可见性下限（WCAG 1.4.11）
 *   info  ─────   —— 只报不判：禁用态（WCAG 1.4.3 明确豁免）与纯装饰性分隔线。
 *                   它们低于阈值不代表不合格，但连 1.5 都不到就说明这一层其实不存在。
 */
import { readFileSync } from 'node:fs';

/* ── 解析 index.css 的两套变量 ───────────────────────── */

/** 取 `:root {` / `:root[data-theme='light'] {` 那个块的声明（不处理嵌套 @media） */
function block(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`找不到选择器 ${selector}`);
  const open = css.indexOf('{', start);
  // 块内没有嵌套大括号，找到第一个 } 就行
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/**
 * 静态读取一套色板：dark = 仅 :root，light = :root 叠加浅色覆盖。
 * @returns {{dark: Map<string,string>, light: Map<string,string>, names: string[]}}
 */
export function readPaletteFromCss(cssPath) {
  const css = readFileSync(cssPath, 'utf8');
  const dark = block(css, ':root {');
  const light = new Map([...dark, ...block(css, ":root[data-theme='light']")]);
  if (dark.size < 30) throw new Error(`:root 只解析到 ${dark.size} 个变量，色板文件结构可能变了`);
  return { dark, light, names: [...new Set([...dark.keys(), ...light.keys()])] };
}

/* ── 颜色 ─────────────────────────────────────────────── */

const NAMED = {
  white: [255, 255, 255], black: [0, 0, 0], transparent: [0, 0, 0, 0],
};

/** 当前正在解析的那套变量表（check() 每次换主题时重置） */
let VARS = new Map();

/** 只认 #hex / rgb() / rgba()；渐变取第一个色标（前景用它近似最亮端） */
function parseColor(raw, depth = 0) {
  if (depth > 6 || raw == null) return null;
  let s = String(raw).trim();

  const ref = s.match(/^var\((--[\w-]+)\)/);
  if (ref) return parseColor(VARS.get(ref[1]) ?? null, depth + 1);

  if (NAMED[s.toLowerCase()]) return NAMED[s.toLowerCase()];

  if (s.startsWith('linear-gradient') || s.startsWith('radial-gradient')) {
    const inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'));
    // 按顶层逗号切，取第一段里出现的颜色
    const stops = splitTop(inner);
    for (const st of stops) {
      const c = st.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i);
      if (c) return parseColor(c[0], depth + 1);
    }
    return null;
  }

  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) h += 'ff';
    if (h.length !== 8) return null;
    return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  const rgb = s.match(/^rgba?\(([^)]*)\)/i);
  if (rgb) {
    const n = rgb[1].match(/[\d.]+/g);
    if (!n) return null;
    const [r, g, b, a = 1] = n.map(Number);
    return [r, g, b, Math.round(a * 255)];
  }
  return null;
}

function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 半透明色合成到底色上 —— 不合成会得出「rgba(0,0,0,.05) 是黑的」这种错判 */
function over(fg, bg) {
  if (!fg) return bg;
  if (!bg) return fg;
  const a = (fg[3] ?? 255) / 255;
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)));
}

const lum = ([r, g, b]) => {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export function ratio(fg, bg) {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/* ── 待检组合 ──────────────────────────────────────────
   每行 [前景变量, 底色变量, 档位, 说明]。底色是一个**链**：从第一项开始依次往前景方向
   合成，所以 ['--ok-bg', '--card'] 表示 ok 底色画在卡片底上 —— 这层「第二层底色」
   正是肉眼最容易放过、实际只有 3 点几比 1 的地方。 */
export const PAIRS = [
  // 基础文字三层：卡片 / 卡片内嵌 / 页面底色三处都要成立
  ['--fg', ['--bg'], 'text', '正文 · 页面底'],
  ['--fg', ['--card'], 'text', '正文 · 卡片'],
  ['--fg', ['--card2'], 'text', '正文 · 内嵌块'],
  ['--dim', ['--card'], 'text', '次要文字 · 卡片'],
  ['--dim', ['--card2'], 'text', '次要文字 · 内嵌块'],
  ['--mute', ['--card'], 'text', '说明文字 · 卡片'],
  ['--mute', ['--card2'], 'text', '说明文字 · 内嵌块'],
  ['--mute', ['--bg'], 'text', '说明文字 · 页面底'],
  ['--ph', ['--card'], 'text', '输入占位符 · 卡片'],
  ['--na-off', ['--card2'], 'text', '未知值「—」· 内嵌块'],
  ['--dis-fg', ['--card2'], 'info', '禁用文字 · 内嵌块（WCAG 豁免，仅观察）'],

  // 语义三件套：前景画在自己的底色上 —— 这是最容易漏的一层
  ['--ok-fg', ['--ok-bg', '--card'], 'text', '达标 · 卡内'],
  ['--bad-fg', ['--bad-bg', '--card'], 'text', '超限 · 卡内'],
  ['--warn-fg', ['--warn-bg', '--card'], 'text', '不确定 · 卡内'],
  ['--info-fg', ['--info-bg1', '--card'], 'text', '提示 · 卡内'],
  ['--info-fg2', ['--info-inset', '--info-bg1', '--card'], 'text', '提示内嵌条'],
  ['--body-fg', ['--info-bg1', '--card'], 'text', '建议卡正文'],
  ['--li-fg', ['--info-bg1', '--card'], 'text', '建议卡列表项'],
  ['--ai-fg', ['--ai-bg', '--card'], 'text', 'AI 标记'],

  // 强调色当文字用（导航选中、今日柱标签、链接）
  ['--green', ['--bg'], 'text', '绿色文字 · 页面底'],
  ['--green', ['--card'], 'text', '绿色文字 · 卡片'],
  ['--amber', ['--card'], 'text', '琥珀文字 · 卡片'],
  ['--red', ['--card'], 'text', '红色文字 · 卡片'],
  ['--under-fg', ['--under-bg', '--card'], 'text', '偏低 · 卡内'],
  ['--hit-fg', ['--card2'], 'text', '达标值 · 内嵌块'],

  // 图形 / 描边：只需 3:1，但低于它就「看不见」，不是「不好看」
  ['--track', ['--card'], 'ui', '进度条空轨道'],
  ['--track', ['--card2'], 'ui', '内嵌块里的轨道'],
  ['--dot', ['--card2'], 'ui', '未达标圆点'],
  ['--line', ['--card'], 'info', '输入框描边（还有底色差兜底）'],
  ['--line', ['--bg'], 'info', '卡片外的分隔线'],
  ['--target-line', ['--card'], 'ui', '目标虚线'],
  ['--t3-track', ['--info-inset', '--card'], 'ui', 'TOP3 空槽'],

  // 品牌色上的字：按钮 / FAB —— 反白还是深字必须真的读得出来
  ['--on-accent', ['--btn-bg'], 'text', '主按钮文字'],
  ['--bar-fg', ['--bar-bg'], 'large', '柱内数字'],
  // 180deg 渐变取第一个色标 = 柱顶 = 数字实际落点，所以这里量到的就是最差情况。
  // 曾漏检这条：柱内数字在普通柱上是 4.74，在超限柱的琥珀底上只有 4.58（余量 0.08），
  // 校验器没报，是因为只挂了 --bar-bg 一条链。加 --bar-over 后这个缺口不存在了。
  ['--bar-fg', ['--bar-over'], 'large', '超限柱的柱内数字'],

  // 卡片底色与页底的色差：分层由「描边 + 阴影 + 三层明度阶梯」共同承担，
  // 单看色差会误判（V2 的奶油纸本来就靠 1px 暖边和极浅阴影"浮起来"）。
  ['--card', ['--bg'], 'info', '卡片与页底的色差（还有描边与阴影兜底）'],
];

export const THRESH = { text: 4.5, large: 3.0, ui: 3.0, info: 0 };

/**
 * 已知豁免：**不达 ui 阈值但经过判断可以接受**的组合。
 * 每条必须写理由，否则下一个人分不清"刻意"和"漏了"。
 * 判据是这些元素不承载"必须辨认"的状态信息 —— 状态由别处（文字数值、填充条）承担。
 */
export const EXEMPT = new Map([
  ['--track', '进度条空槽。刻意压到 1.35~1.75：高于 1.75 时空槽会被读成"已填充"（旧浅色 2.06 的教训），低于 1.35 则看不见沟槽。状态由填充条 + 数值文字承担。'],
  ['--dot', '微量格未达标圆点。这里是"沉默"信号，强调留给达标态的绿点；14 格全靠点会看不过来。'],
  ['--t3-track', 'TOP3 空槽，同 --track 的理由，画在更深的便签底上。'],
]);

/**
 * 按 PAIRS 逐条算一遍。
 * @param {string} themeName 仅用于回填，不参与计算
 * @param {Map<string,string>} vars 变量名 → 值（字面量或 var() 引用都支持）
 * @returns {Array<{note:string,fgName:string,ratio:number|null,need:number,ok:boolean,exempt?:boolean,missing?:string}>}
 */
export function check(themeName, vars) {
  const prev = VARS;
  VARS = vars;
  const rows = [];
  for (const [fgName, bgChain, tier, note] of PAIRS) {
    let bg = parseColor(vars.get(bgChain[0]) ?? null);
    for (const next of bgChain.slice(1)) bg = over(parseColor(vars.get(next) ?? null), bg);
    let fg = parseColor(vars.get(fgName) ?? null);
    if (!fg || !bg) {
      rows.push({ note, fgName, ratio: null, need: THRESH[tier], ok: false, missing: !fg ? fgName : bgChain[0] });
      continue;
    }
    // 前景若半透明（如 --bar-fg 是 rgba 黑），先合成到底色上再算 —— 否则算的是错的
    fg = over(fg, bg);
    const r = ratio(fg, bg);
    const ok = r >= THRESH[tier];
    rows.push({ note, fgName, ratio: r, need: THRESH[tier], ok, exempt: !ok && EXEMPT.has(fgName) });
  }
  VARS = prev;
  return rows;
}

/** 打印式输出：返回不达标条数（调用方据此决定退出码） */
export function printRows(out) {
  let bad = 0;
  for (const [theme, rows] of Object.entries(out)) {
    console.log(`\n=== ${theme === 'dark' ? '深色' : '浅色'} ===`);
    for (const r of rows) {
      if (r.ratio == null) {
        // 打印真正缺的那个（底色链上缺的可能不是 fgName 本身）
        console.log(`  ?  ${r.note.padEnd(22)} ${r.missing ?? r.fgName} 未定义或不可解析`);
        bad++;
        continue;
      }
      if (!r.ok && !r.exempt) bad++;
      const flag = r.ok ? '  ' : r.exempt ? '◐ ' : '✗ ';
      console.log(`  ${flag}${r.ratio.toFixed(2).padStart(5)}  (需 ${r.need})  ${r.note}`);
      if (r.exempt) console.log(`         └ 已豁免：${EXEMPT.get(r.fgName)}`);
    }
  }
  return bad;
}
