/**
 * 主题自检：深色 / 浅色两套，各在**独立浏览器上下文**里从零安装一次，走完引导，
 * 落到首页，然后把「浏览器真正解析出来的东西」逐条验一遍。
 *
 * 三个它必须能挡住的事故：
 * 1. 某处用了 var() 但对应主题忘了给值 —— 浏览器把整条声明当无效丢弃，
 *    表现是「文字变成默认黑」，不报错。
 * 2. 第二层底色上的字读不出来（--mute 画在 --card2 上、--ok-fg 画在 --ok-bg 上），
 *    肉眼看着还行，实际 3 点几比 1。这类组合见 tools/lib/palette.mjs 的 PAIRS。
 * 3. 外链样式表没生效 —— 内联首帧样式里有 20~37 个变量，足以让「正文对比度」
 *    这一条**照样通过**，但整页的卡片/栅格/描边全没了。所以这里专门验一个
 *    只存在于外链那份的变量（--t3-track），它空 = 外链没应用。
 *
 * 纪律（这个项目被它坑过一次）：**元素找不到时 throw，不要静默返回空数组**。
 * 0.9.5 之后新库停在引导页，老脚本 waitForSelector('.hdr') 超时、或者量到引导页
 * 却照样 exit 0 —— 那是"绿灯的瞎测"，比红灯危险得多。所以：
 *   · 先 completeOnboarding()，再断言；
 *   · 必需元素缺失在 page 内直接 throw，整轮退出码 1；
 *   · 量到 .welcome 也 throw（引导没走完）。
 *
 * 用法：
 *   node tools/check-theme.mjs              # 自己起静态服务托管 dist/
 *   node tools/check-theme.mjs http://...   # 指向已在跑的服务
 * 退出码 1 = 有不达标项。
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { completeOnboarding } from './lib/onboard.mjs';
import { readPaletteFromCss, check, printRows } from './lib/palette.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4179;
const DIST = resolve(import.meta.dirname, '../dist');

/* ── 期望的变量全集（两个 :root 块的并集，来自 src/index.css） ───── */
const { names: EXPECTED_VARS } = readPaletteFromCss('src/index.css');

/* ── 必需元素：全部在「不许改名」清单里，缺一个就 throw ──────────── */
const REQUIRED = [
  { sel: '.app', min: 1, why: '页面外壳' },
  { sel: '.main', min: 1, why: '内容区（滚动容器，底色由它承担）' },
  { sel: '.hdr', min: 1, why: '页头' },
  { sel: '.hdr h1', min: 1, why: '页标题：正文对比度的取样点' },
  { sel: '.tabbar', min: 1, why: '底部导航（Shell 是否常驻）' },
  { sel: '.card', min: 1, why: '卡片：第二层底色的起点' },
];

/** 只存在于外链样式表里的变量：它取不到值 = 外链没应用（异步 CSS 的回归闸门） */
const EXTERNAL_ONLY_VAR = '--t3-track';

/* ── 静态服务（dist）─────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function startServer() {
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // 和线上一致：站点可能挂在 /p/xxx/ 下，base 是 './'
    const m = path.match(/^\/p\/[^/]+(\/.*)?$/);
    if (m) path = m[1] || '/';
    if (path.endsWith('/')) path += 'index.html';
    const file = join(DIST, path);
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  return server;
}

/* ── 一轮测量 ─────────────────────────────────────────────────── */

async function run(browser, url, scheme) {
  // 独立上下文 = 独立 localStorage / IndexedDB：两套主题各自「首次安装」，
  // 否则第一轮写下的 app.theme 会把第二轮钉死在深色上。
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const onboarded = await completeOnboarding(page);
  await page
    .waitForSelector('.hdr h1', { timeout: 60_000 })
    .catch((e) => {
      throw new Error(`走了引导但首页 60s 内没画出 .hdr h1：${e.message}`);
    });
  // 等一次动画/过渡落定（柱图、环的入场）
  await new Promise((r) => setTimeout(r, 900));

  const snap = await page.evaluate(({ REQUIRED, EXPECTED_VARS, EXTERNAL_ONLY_VAR }) => {
    /* ① 必需元素：缺了就 throw，绝不静默返回空数组 */
    const missing = [];
    for (const { sel, min, why } of REQUIRED) {
      const n = document.querySelectorAll(sel).length;
      if (n < min) missing.push(`${sel}（期望 ≥${min}，实际 ${n}）—— ${why}`);
    }
    if (missing.length) {
      throw new Error('必需元素缺失，后续测量全部不可信：\n  - ' + missing.join('\n  - '));
    }
    /* ② 量到引导页也是"绿灯的瞎测"，一起 throw */
    if (document.querySelector('.welcome')) {
      throw new Error('量到的是引导页（.welcome）而不是首页 —— 引导没走完，对比度数据无意义');
    }

    const root = document.documentElement;
    const cs = getComputedStyle(root);

    /* ③ 变量全集：逐名取，不用枚举（Chromium 的 computed style 不保证列出 custom property） */
    const vars = {};
    const empty = [];
    for (const n of EXPECTED_VARS) {
      const v = cs.getPropertyValue(n).trim();
      vars[n] = v;
      if (!v) empty.push(n);
    }

    /* ④ 合成背景色：从元素往上叠，直到不透明为止 —— 不能假设"底就是 body" */
    const parse = (s) => {
      const m = (s || '').match(/[\d.]+/g);
      if (!m) return null;
      const [r, g, b, a = 1] = m.map(Number);
      return [r, g, b, a];
    };
    function bgOf(el) {
      const stack = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (!c || c[3] === 0) continue;
        stack.push(c);
        if (c[3] >= 1) break;
      }
      let acc = [255, 255, 255]; // html 之上是画布，浏览器默认白
      for (let i = stack.length - 1; i >= 0; i--) {
        const [r, g, b, a] = stack[i];
        acc = [r, g, b].map((v, k) => v * a + acc[k] * (1 - a));
      }
      return acc;
    }
    const lum = ([r, g, b]) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (h + 0.05) / (l + 0.05);
    };
    /** 元素的文字色合成到它的实际底色上，再算对比度 */
    function textRatio(el) {
      const fg = parse(getComputedStyle(el).color);
      const bg = bgOf(el);
      if (!fg) return null;
      const a = fg[3];
      const composed = [fg[0], fg[1], fg[2]].map((v, k) => v * a + bg[k] * (1 - a));
      const size = parseFloat(getComputedStyle(el).fontSize);
      const bold = (parseInt(getComputedStyle(el).fontWeight, 10) || 400) >= 700;
      return {
        ratio: ratio(composed, bg),
        need: size >= 24 || (size >= 18.66 && bold) ? 3.0 : 4.5,
        size,
        bg: `rgb(${bg.map(Math.round).join(',')})`,
        fg: getComputedStyle(el).color,
      };
    }

    /* ⑤ 浅色里残留深色块 —— 只算**实际合成后**的亮度，rgba 也要走同一套判据。
       注意这里用的是「感知亮度」的加权平均（0~255 归一化），不是 WCAG 那个带 gamma
       的相对亮度：判的是「这块看起来是不是黑的」，不是对比度。第一版把两者搞混，
       拿 0~1 的相对亮度去比 0.35（等价阈值 89/255），于是奶油白也被判成深色 —— 全量误报。
       合成底也不能假设白：浅色主题的纸是 --bg，叠在它上面才是用户看到的颜色。 */
    const pageBg = parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    const perceive = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const ALWAYS_DARK = new Set(['updatechip']); // 悬浮胶囊恒用品牌绿 + 深绿字，两版一致
    const residualDark = [];
    document.querySelectorAll('*').forEach((el) => {
      const cls = el.className?.toString() || '';
      for (const c of ALWAYS_DARK) if (cls.includes(c)) return;
      const c = parse(getComputedStyle(el).backgroundColor);
      if (!c || c[3] === 0) return;
      const composed = [c[0], c[1], c[2]].map((v, k) => v * c[3] + pageBg[k] * (1 - c[3]));
      if (perceive(composed) < 0.35) {
        residualDark.push({
          cls: cls.slice(0, 40) || el.tagName.toLowerCase(),
          bg: getComputedStyle(el).backgroundColor,
          inline: (el.getAttribute('style') || '').slice(0, 80) || null,
        });
      }
    });

    const sheet = [...document.styleSheets].find((s) => (s.href || '').includes('/assets/'));
    return {
      theme: root.getAttribute('data-theme'),
      colorScheme: cs.colorScheme,
      vars,
      empty,
      externalVar: cs.getPropertyValue(EXTERNAL_ONLY_VAR).trim(),
      externalSheet: sheet ? { href: sheet.href.split('/').pop(), media: sheet.media.mediaText } : null,
      title: document.querySelector('.hdr h1').textContent.trim().slice(0, 24),
      h1: textRatio(document.querySelector('.hdr h1')),
      card: textRatio(document.querySelector('.card')), // 卡片上的正文（若卡片本身没文字，量的是继承色）
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyFg: getComputedStyle(document.body).color,
      cards: document.querySelectorAll('.card').length,
      navItems: document.querySelectorAll('.tabbar a').length,
      residualDark,
    };
  }, { REQUIRED, EXPECTED_VARS, EXTERNAL_ONLY_VAR });

  await page.screenshot({ path: `tools/.shots/theme-${scheme}.png` });
  await ctx.close();

  const fails = [];
  if (snap.theme !== scheme) fails.push(`data-theme=${snap.theme}（应为 ${scheme}）`);
  if (snap.colorScheme !== scheme) fails.push(`color-scheme=${snap.colorScheme}（原生控件配色会不对）`);
  if (pageErrors.length) fails.push(`页面报错：${pageErrors.join(' | ')}`);

  // 变量完整性：一个主题里漏配，那条声明就会整体失效
  for (const n of snap.empty) fails.push(`${n} 取不到值（该主题漏配？）`);

  // 外链样式表真的应用了（异步 media="print" 的回归闸门）
  if (!snap.externalVar) {
    fails.push(
      `${EXTERNAL_ONLY_VAR} 取不到值 —— 外链样式表没生效（media 没从 print 切回 all？）` +
        `，页面只剩内联首帧样式。当前外链：${JSON.stringify(snap.externalSheet)}`,
    );
  }

  // 真实元素上的正文对比度（逐元素合成真实底色，不是假设白底）
  for (const [label, t] of [['页标题', snap.h1], ['卡片正文', snap.card]]) {
    if (!t) continue;
    if (t.ratio < t.need) {
      fails.push(`${label} 对比度仅 ${t.ratio.toFixed(2)}（需 ${t.need}）${t.fg} on ${t.bg}（${t.size}px）`);
    }
  }

  // 34 组色板口径，输入是浏览器解析出来的变量
  const rows = check(scheme, new Map(Object.entries(snap.vars)));
  const bad = printRows({ [scheme]: rows });

  if (scheme === 'light') {
    for (const d of snap.residualDark) {
      fails.push(`浅色里残留深色块：.${d.cls} background=${d.bg}${d.inline ? ` style="${d.inline}"` : ''}`);
    }
  }

  for (const r of rows) {
    // 不在这里加 scheme 前缀：上层统一加，加两次会变成「light: light: ...」
    if (r.ratio == null) fails.push(`${r.note} —— ${r.missing} 未定义或不可解析`);
    else if (!r.ok && !r.exempt) fails.push(`${r.note} 仅 ${r.ratio.toFixed(2)}（需 ${r.need}）`);
  }
  void bad;

  return {
    scheme,
    onboarded,
    fails,
    report: {
      theme: snap.theme,
      colorScheme: snap.colorScheme,
      title: snap.title,
      externalSheet: snap.externalSheet,
      body: `${snap.bodyFg} on ${snap.bodyBg}`,
      h1: snap.h1 && { ratio: +snap.h1.ratio.toFixed(2), need: snap.h1.need, fg: snap.h1.fg, bg: snap.h1.bg },
      cards: snap.cards,
      navItems: snap.navItems,
      vars: snap.vars,
      pairs: rows.length,
    },
  };
}

/* ── 主流程 ───────────────────────────────────────────────────── */

const ARG_URL = process.argv[2];
if (!ARG_URL) {
  await stat(join(DIST, 'index.html')).catch(() => {
    throw new Error('dist/index.html 不存在 —— 先 npm run build，或用 node tools/check-theme.mjs <url> 指向已跑的服务');
  });
}
const server = ARG_URL ? null : await startServer();
const url = ARG_URL || `http://127.0.0.1:${PORT}/`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});

let report = {};
const fails = [];
try {
  for (const scheme of ['dark', 'light']) {
    const r = await run(browser, url, scheme);
    report[scheme] = r.report;
    for (const f of r.fails) fails.push(`${scheme}: ${f}`);
  }
} finally {
  await browser.close();
  server?.close();
}

/* 两套必须真的不一样，否则等于浅色版没生效 */
const MUST_DIFFER = [
  '--bg', '--card', '--card2', '--line', '--fg', '--dim', '--mute',
  '--green', '--amber', '--red', '--track', '--ok-fg', '--bad-fg',
];
if (report.dark && report.light) {
  for (const k of MUST_DIFFER) {
    if (report.dark.vars[k] === report.light.vars[k]) {
      fails.push(`${k} 深浅两版取值相同（${report.dark.vars[k]}）——浅色版漏配`);
    }
  }
}

await writeFile('theme-report.json', JSON.stringify(report, null, 2));
console.log('\n' + JSON.stringify({
  dark: { title: report.dark?.title, body: report.dark?.body, h1: report.dark?.h1, cards: report.dark?.cards, nav: report.dark?.navItems, externalSheet: report.dark?.externalSheet },
  light: { title: report.light?.title, body: report.light?.body, h1: report.light?.h1, cards: report.light?.cards, nav: report.light?.navItems, externalSheet: report.light?.externalSheet },
}, null, 2));

if (fails.length) {
  console.error('\nFAIL:');
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log(`\nPASS：双主题 × ${report.dark.pairs} 组色板判据 + 真元素对比度 + 变量完整性 + 外链生效，全部通过`);
