/**
 * 首帧关键 CSS：从 src/index.css 里**抽取**，不许手抄。
 *
 * 为什么必须抽而不是复制一份：外链 CSS 是渲染阻塞的，等它回来才画第一帧，
 * 在那之前浏览器只有默认白底。要在 CSS 回来之前就画出「正确的底色 + 外壳框架」，
 * 就必须把这几条规则内联进 index.html。
 *
 * 而内联副本一旦和源文件各写一份，**必然漂**：改主题变量时没人会记得改 index.html
 * 里那坨压缩过的 CSS，表现是「首帧闪一下旧配色」。这类 bug 只在弱网且冷启动且
 * 主题与上次不同时出现，测不出来、报不上来。所以做成构建期抽取：
 * `src/index.css` 永远是唯一真源，内联的那份是它的派生物。
 *
 * 抽哪些：见 CRITICAL_SELECTORS。原则是「第一帧肉眼能看见的东西」——
 * 变量 + reset + body + 外壳（.app / .main / .hdr / .tabbar）。
 * 卡片、列表、图表都不抽：它们要等数据，第一帧本来就没有。
 *
 * 不抽的东西也要说清楚代价：内联块里没有卡片 / 列表 / 图表 / 表单等组件样式，
 * 所以它**不能**替代外链 CSS，外链必须原样保留。它只负责「第一帧不难看」。
 *
 * 内联块里现在**确实**有 `@media` 和动画（`.boot` 骨架的 `@keyframes boot-sweep`
 * 与两条 `prefers-reduced-motion` 降级）—— 因为骨架就画在第一帧里，它不抽就是裸 span。
 * 但这是特例不是惯例：往 CRITICAL_SELECTORS 里加东西前先算 gzip 账，
 * 每一 KB 都是每次冷启动都要付的。
 *
 * 已知项（试过、不划算）：内联块会被 lightningcss 压一遍，
 * 压缩后 5,249 B / gzip 2,751；**不压**是 4,350 B / gzip 1,716 —— 也就是说压缩反而
 * 让 gzip 多 1 KB（gzip 本来就吃掉重复，压缩破坏了重复性，而 lightningcss 还加了
 * `*,:before,:after` 与 `--lightningcss-*` 这些字节）。想拿到那 1 KB 就得把注入挪到
 * 压缩之后，但占位符在 `<style>` 里会被 css 压缩器一起干掉（试过 order:'post'，
 * 插件当场报「找不到占位符」）。所以保持 order:'pre'。
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * index.html 里`<style>` 内的占位符。
 *
 * 用这种带双下划线的怪名字，不是洁癖：第一版用的是 `@critical-css` 配注释外壳，
 * 结果 index.html 里解释这个占位符的那段 HTML 注释**原样包含**了同一个字符串，
 * 于是 `html.replace()` 命中了注释里那份（在 `<style>` 之前），
 * 7KB 关键 CSS 被注进了注释、真正的占位符没被替换 —— 首帧样式一条都没生效，
 * 而且构建是通过的、dist 里也"有"那段 CSS，只是它在注释里。
 * 现在占位符只出现一次，并且下面会断言出现次数。
 */
export const CRITICAL_MARKER = '/*__CRITICAL_CSS__*/';

/**
 * 首帧必须内联的规则。
 *
 * 这里写的是 `src/index.css` 里的**选择器原文**（空白会被归一化后比对）。
 * 如果哪天有人改了这些选择器，构建会打印警告 —— 那是提醒「首帧会掉一条规则」，
 * 不是错误（视觉改造期间一直在动这些名字，不该因此把构建卡死）。
 */
export const CRITICAL_SELECTORS: readonly string[] = [
  // ── 两套主题的全部变量 ──
  ':root',
  ":root[data-theme='light']",
  // ── reset 与排版底座 ──
  '*',
  'html, body, #root',
  'body',
  // ── 外壳：三个「第一帧就该在」的容器 ──
  '.app',
  'html.ios-standalone .app',
  '.main',
  '.main.center',
  '.hdr',
  '.hdr > div:first-child',
  '.hdr h1',
  '.hdr .sub',
  '.tabbar',
  '.tabbar a',
  '.tabbar a.on',
  '.tabbar .ico',
  '.tabbar .fab',
  '.tabbar .fab button',
  '.tabbar .fab button.on',
  '.tabbar .fab button:active',
  // ── 首帧骨架（源在 src/index.css，不是 index.html）──
  // 外链 CSS 是 media="print" 非阻塞的：首帧只靠上面那个内联块。
  // 骨架这四条不抽的话，`.boot` 会是一个没有任何样式的裸 <span>，
  // 而它在 CSS chunk 回来之前就是用户看到的全部内容。
  // @media 那条用整串查询当选择器（readRules 把 @media 块当一个顶层规则读），
  // 顺带会把同查询的全局 reduced-motion 降级一起带上 —— 那是想要的。
  '.boot',
  '.boot-hdr',
  '.boot-bar',
  '.boot-bar::after',
  '@keyframes boot-sweep',
  '@media (prefers-reduced-motion: reduce)',
];

interface Rule {
  selector: string;
  body: string;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * 去掉注释。注释占 :root 那两块里的大头（大量中文「为什么」），
 * 内联进 index.html 只是增加首字节，没有任何作用。
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * 把 CSS 切成顶层规则。手写而不是用 postcss：
 * 只需要「选择器 + 规则体」两样东西，引一个解析器进构建链不值当。
 *
 * 必须处理字符串（含引号包裹的 `url("data:image/svg+xml,<svg ...>")`）：
 * 里面的 `;` `{` `}` 不属于结构，简单数括号会切错位置。
 */
function readRules(css: string): Rule[] {
  const out: Rule[] = [];
  const n = css.length;
  let quote: string | null = null;
  let start = 0; // 当前规则选择器的起点
  let bodyStart = -1; // 当前规则体（'{' 之后）的起点
  let depth = 0;

  for (let i = 0; i < n; i++) {
    const ch = css[i]!;

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      // 只有深度 0 的 '{' 才是「一条顶层规则的开始」。
      // @media / @supports 也会在深度 0 开块，于是它内部的选择器都在深度 1+，
      // 天然被排除；而 @media 那一整块的选择器是以 '@' 开头的，也不会命中白名单。
      if (depth === 0) bodyStart = i + 1;
      depth++;
      continue;
    }

    if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        out.push({
          selector: normalize(css.slice(start, bodyStart - 1)),
          body: css.slice(bodyStart, i).trim(),
        });
        start = i + 1;
      }
    }
  }
  return out;
}

/** 抽出首帧关键 CSS。纯函数，便于单测与复查。
 *
 * `extraUsageText` = 内联块之外、但**同样属于首帧**的文本（实际传的是整份 index.html，
 * 里面有骨架的 `.boot-*` 规则）。它的作用见下面第 2 步。
 *
 * 三步：
 * 1. 按白名单挑出规则；
 * 2. 算出「首帧真正用到的变量名」，做传递闭包（变量值里也可能 `var()` 另一个变量）；
 * 3. `:root` 两块只保留这些变量，其余删掉。
 *
 * 第 3 步为什么值得做：新色板有 99 个自定义属性，首帧真正用得上的只有 20 个左右。
 * 全量内联等于让**每次冷启动**都为「也许以后某个屏幕会用」的 79 个变量付一次下载
 * （实测省 2KB 以上 gzip —— 这不是提前优化，是每天几十万次冷启动乘一次）。
 * 而且它是**派生**的：谁引用了什么由 AST 级别的扫描算出来，不会漂。
 * 想要全量，传 `keepAllVars: true`。
 */
export function extractCriticalCss(
  css: string,
  extraUsageText = '',
  opts: { keepAllVars?: boolean } = {},
): string {
  const wanted = new Set(CRITICAL_SELECTORS.map(normalize));
  const found = new Set<string>();
  const picked: Rule[] = [];

  for (const rule of readRules(stripComments(css))) {
    if (!wanted.has(rule.selector)) continue;
    found.add(rule.selector);
    picked.push(rule);
  }

  const missing = [...wanted].filter((s) => !found.has(s));
  if (missing.length > 0) {
    // 警告而不是报错：视觉改造期间选择器本来就可能被改写，
    // 那时该做的是补 CRITICAL_SELECTORS，而不是让整个构建起不来。
    console.warn(`[critical-css] 这些选择器在 src/index.css 里没找到，首帧会缺规则：\n  ${missing.join('\n  ')}`);
  }

  if (opts.keepAllVars) return picked.map(render).join('\n');

  const isVarBlock = (r: Rule) => r.selector === ':root' || r.selector.startsWith(':root[');

  // ① 非变量块的规则体 + 内联骨架，谁引用了什么
  const used = new Set<string>();
  /** 引用了但**没有兜底值**的那些（`var(--x, 16px)` 不算，它有兜底） */
  const needsDef = new Set<string>();
  const collect = (text: string) => {
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) {
      used.add(m[1]!);
      if (m[2] === ')') needsDef.add(m[1]!);
    }
  };
  for (const r of picked) if (!isVarBlock(r)) collect(r.body);
  collect(extraUsageText);

  // ② 传递闭包：--a 的值里写了 var(--b)，那 --b 也得留
  const defs = new Map<string, string>();
  for (const r of picked) {
    if (!isVarBlock(r)) continue;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*)/g)) defs.set(m[1]!, m[2]!);
  }
  const queue = [...used];
  while (queue.length > 0) {
    const name = queue.pop()!;
    const value = defs.get(name);
    if (!value) continue;
    for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!used.has(m[1]!)) {
        used.add(m[1]!);
        queue.push(m[1]!);
      }
    }
  }

  // ③ 无兜底地用了、但全文件都找不到定义 → 拼错，或忘了加进 :root。
  // 这类错误在浏览器里不报错：整条声明被当作无效值丢掉，表现是「某个颜色突然没了」。
  // `--app-h` 不会命中这里：它是 JS 运行时写的（ui/keyboard.ts），
  // 而 `.app` 里写的是 `var(--app-h, 100dvh)` —— 有兜底。
  const undefinedVars = [...needsDef].filter((name) => !defs.has(name) && !css.includes(`${name}:`));
  if (undefinedVars.length > 0) {
    console.warn(`[critical-css] 首帧无兜底地引用了这些变量，但 src/index.css 里没有定义：\n  ${undefinedVars.join('\n  ')}`);
  }

  return picked
    .map((r) => (isVarBlock(r) ? `${r.selector}{${dropUnusedVars(r.body, used)}}` : render(r)))
    .join('\n');
}

const render = (r: Rule) => `${r.selector}{${r.body}}`;

/**
 * 删掉没用到的自定义属性声明。
 * 只动 `--x: ...;` 这种形态；`color-scheme: dark` 之类的普通声明原样保留
 * （它决定原生滚动条/下拉的配色，不属于"变量"）。
 */
function dropUnusedVars(body: string, used: Set<string>): string {
  return body
    .replace(/(--[\w-]+)\s*:\s*([^;{}]*);/g, (all, name: string) => (used.has(name) ? all : ''))
    // 删完之后会留一串空行，压掉（内联进 HTML，一个字节都算钱）
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Vite 插件：把抽出来的关键 CSS 注入 index.html 的占位符。
 *
 * 走 transformIndexHtml 而不是 writeBundle 改写 dist/index.html：
 * 前者在 `vite dev` 下同样生效（同一个 HTML 会经过这条钩子），
 * 后者只覆盖生产构建 —— 而开发时恰恰最需要它，否则「首帧正确」这件事根本没法调。
 *
 * 已知限制（dev）：内联的是**本次页面加载时** index.css 的快照。
 * 开发中改 CSS，运行时注入的那份会覆盖它（后插入的 <style> 同特异性胜出），
 * 所以看到的颜色永远是对的，只是「首帧」这一瞬仍是旧值。不值得为此加一次全页刷新：
 * 那会把别人正在调的 CSS HMR 打断。
 */
export function criticalCssPlugin(projectRoot: string): Plugin {
  const cssFile = resolve(projectRoot, 'src/index.css');
  return {
    name: 'haohaochifan:critical-css',
    transformIndexHtml: {
      order: 'pre',
      async handler(html: string) {
        const css = await readFile(cssFile, 'utf8');
        // extraUsageText 传整份 html：骨架的 .boot-* 规则住在 index.html 里，
        // 不传的话它引用的变量会被当成"没人用"而被裁掉。
        const critical = extractCriticalCss(css, html);
        const hits = html.split(CRITICAL_MARKER).length - 1;
        if (hits === 0) {
          this.warn(`index.html 里找不到占位符 ${CRITICAL_MARKER}，首帧关键样式没有注入`);
          return html;
        }
        if (hits > 1) {
          // 别处（通常是解释性注释）又写了一遍这个字符串 → 会注入到错误的位置，
          // 而且构建仍然「成功」。宁可报错也不要静默产出没有首帧样式的产物。
          this.error(`index.html 里出现了 ${hits} 次 ${CRITICAL_MARKER}，占位符必须唯一`);
          return html;
        }
        // 用函数式 replace：内联 CSS 里可能有 `$&` 之类的替换模式字符
        return html.replace(CRITICAL_MARKER, () => critical);
      },
    },
  };
}

/**
 * 把 `<link rel="stylesheet">` 改成**非渲染阻塞**，并补 `<noscript>` 兜底。
 *
 * 为什么必须做：内联关键 CSS 解决了「颜色对不对」，但**没有解决「什么时候开始画」**。
 * 浏览器要等所有渲染阻塞样式表到齐才首绘 —— 实测把外链 CSS 延后 4 秒，
 * 连 t=200ms 的截图都要等到 4154ms 才返回。也就是说内联的收益被那条 link 抵消了：
 * 弱网上用户仍要盯着空白过完整个 CSS 往返（49KB / gz 9.7 ≈ 1~2 秒）。
 *
 * 改法是最老的那一招：`media="print"` 让它不参与首绘，`onload` 回来再把 media
 * 改回 `all`。浏览器仍会请求它（以较低优先级），所以样式不会丢；而首帧不必等它。
 *
 * 三条必须守住的：
 * 1. **`<noscript>` 兜底不能省。** 真机上 JS 被系统策略/拦截规则掐掉时，
 *    用户会看到一屏**裸 HTML**（白底黑字、卡片堆成一列）—— 那比白屏更像"App 坏了"。
 *    有 noscript 就退回成"JS 不可用，但长得还像这个 App"。
 * 2. **外链那份 CSS 必须是完整的**，绝不能也被裁剪：内联裁的是「首帧用得到的那 20 个
 *    变量」，外链要供整站 99 个。裁错了表现是「滚到某个区块颜色突然消失」。
 *    （裁剪只发生在 extractCriticalCss 的返回值里，这条链不碰任何文件写入。）
 * 3. 只在**构建产物**上改。dev 模式 HTML 里根本没有这条 link（CSS 由 JS 注入），
 *    找不到就 warn 而不是 error —— 那不是故障。
 */
export function asyncStylesheetPlugin(): Plugin {
  return {
    name: 'haohaochifan:async-stylesheet',
    transformIndexHtml: {
      // 必须 post：`<link>` 是 vite:css-post 在构建后期注入的，pre 阶段它还不在
      order: 'post',
      handler(html: string) {
        let count = 0;
        const out = html.replace(/<link\b[^>]*>/gi, (tag) => {
          const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
          if (!/\bstylesheet\b/.test(rel)) return tag;
          if (/\bmedia\s*=/.test(tag)) return tag; // 已经有人处理过，不重复改
          count++;
          // 插在结尾 `>` 或 `/>` 之前
          const swapped = tag.replace(/\s*\/?>$/, (m) => ` media="print" onload="this.media='all'"${m}`);
          const bare = tag; // noscript 里用原样（阻塞式），那是兜底路径
          return `${swapped}<noscript>${bare}</noscript>`;
        });
        if (count === 0) {
          // dev 下正常；构建下若出现，说明 Vite 注入 link 的时机变了，得回来看
          this.warn('没有找到 <link rel="stylesheet">，非阻塞化没生效（dev 下属正常）');
        }
        return out;
      },
    },
  };
}
