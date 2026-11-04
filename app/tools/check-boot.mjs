/**
 * 首帧骨架自检。
 *
 * 验四件事，每一件都对应一个真实翻过的车：
 *
 * 1. **关掉 JS 后 #root 里必须有可见结构**。这是骨架存在的唯一理由：
 *    在线 wb 版 APK（server.url 指向托管站）每次冷启动都要重新拉 index.html + JS，
 *    原生那边有 SplashView 盖着，网页版**没有**。关掉 JS = 把「等 JS」那一刻冻住。
 * 2. **底色必须已经是主题色**，不能是浏览器默认白底。所以断言 body 的计算背景色
 *    等于 :root 的 --bg，深浅两套都验。
 * 3. **骨架里不许有任何数字**。那时还没读到数据，写「0 kcal」就是撒谎。
 * 4. **骨架不许戴真类名**（.app / .main / .hdr / .tabbar / .card）。tools/check-*.mjs
 *    里有十几处 waitForSelector('.app')，骨架一旦命中真类名，那些「等真页面出来」
 *    的断言会在骨架阶段就通过 —— 验收工具被静默弄瞎。
 *
 * 用法：
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/check-boot.mjs [url]
 * 产物：tools/.shots/boot-{dark,light}.png
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const TARGET = process.argv[2] || 'http://127.0.0.1:4173/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const here = dirname(fileURLToPath(import.meta.url));
const shotDir = resolve(here, '.shots');
mkdirSync(shotDir, { recursive: true });

/** 骨架里绝对不能出现的类名 —— 全是验收工具用来定位真页面的锚点 */
const FORBIDDEN = ['.app', '.main', '.hdr', '.tabbar', '.card', '.welcome', '.tabbar a'];

const results = [];
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=2'],
});

for (const theme of ['dark', 'light']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);

  // 掐掉 JS：等价于「HTML+CSS 到了，JS 还在路上」的那一帧
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/\/assets\/.*\.js(\?|$)/.test(req.url())) void req.abort();
    else void req.continue();
  });

  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 30_000 });

  const snap = await page.evaluate((forbidden) => {
    const root = document.getElementById('root');
    const boot = root?.querySelector('.boot');
    const bar = root?.querySelector('.boot-bar');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    return {
      bootVisible: !!boot && boot.getBoundingClientRect().height > 200,
      bootHeight: boot ? Math.round(boot.getBoundingClientRect().height) : 0,
      // 文本内容必须为空：只画形状，一个字符都不许有（更不许有数字）
      text: (root?.textContent || '').trim(),
      hasDigit: /\d/.test(root?.textContent || ''),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bootBg: cs(boot)?.backgroundColor,
      bar: bar
        ? {
            w: Math.round(bar.getBoundingClientRect().width),
            h: Math.round(bar.getBoundingClientRect().height),
            radius: cs(bar).borderTopLeftRadius,
            track: cs(bar).backgroundColor,
            top: Math.round(bar.getBoundingClientRect().top),
            anim: getComputedStyle(bar, '::after').animationName,
            fill: getComputedStyle(bar, '::after').backgroundColor,
          }
        : null,
      theme: document.documentElement.getAttribute('data-theme'),
      forbidden: forbidden.filter((sel) => root?.querySelector(sel)),
      // 外壳规则是否真的内联进来了（不是靠外链 CSS）
      inlineCritical: [...document.querySelectorAll('style')].some((s) =>
        s.textContent.includes('--bg'),
      ),
    };
  }, FORBIDDEN);

  check(snap.bootVisible, `[${theme}] 骨架可见`, `高度 ${snap.bootHeight}px`);
  check(snap.inlineCritical, `[${theme}] 关键 CSS 是内联的（--bg 在 <style> 里）`);
  // 骨架自己**不刷底色**（和真 .app 一样，底色由 body 的 var(--bg) 铺满画布）。
  // 要断言的是「骨架没有盖出一块和底色不同的色块」——那才会在切换主题时闪。
  check(
    snap.bootBg === 'rgba(0, 0, 0, 0)' || snap.bootBg === snap.bodyBg,
    `[${theme}] 骨架没有盖出与底色不同的色块`,
    `boot=${snap.bootBg} body=${snap.bodyBg}`,
  );
  check(
    snap.bodyBg !== 'rgba(0, 0, 0, 0)' && snap.bodyBg !== 'rgb(255, 255, 255)',
    `[${theme}] 首帧不是浏览器默认白底`,
    snap.bodyBg,
  );
  check(snap.theme === theme, `[${theme}] data-theme 已在首帧前定下`, String(snap.theme));

  // 体验复核-V2 §5「两段式」第一段：只有纸 + 一条 88×3 indeterminate 进度条
  check(
    snap.bar?.w === 88 && snap.bar?.h === 3,
    `[${theme}] 进度条是 88×3`,
    snap.bar ? `${snap.bar.w}×${snap.bar.h}` : 'none',
  );
  check(
    snap.bar?.anim === 'boot-sweep',
    `[${theme}] 进度条是 indeterminate（有动画，不是假进度）`,
    String(snap.bar?.anim),
  );
  check(
    snap.bar != null && snap.bar.track !== 'rgba(0, 0, 0, 0)' && snap.bar.fill !== 'rgba(0, 0, 0, 0)',
    `[${theme}] 进度条的槽与填充都走了变量（有实色）`,
    `track=${snap.bar?.track} fill=${snap.bar?.fill}`,
  );
  // §5 判据三：进度条要落在「标题那一行」的位置（.hdr padding-top 14 + h1 27.6 ≈ 42）
  check(
    snap.bar != null && snap.bar.top >= 40 && snap.bar.top <= 46,
    `[${theme}] 进度条落在 h1 行位置（40~46px）`,
    snap.bar ? `top=${snap.bar.top}` : 'none',
  );
  check(snap.text === '' && !snap.hasDigit, `[${theme}] 骨架里没有任何文字/数字`, JSON.stringify(snap.text));
  check(snap.forbidden.length === 0, `[${theme}] 骨架没有复用真类名`, snap.forbidden.join(','));

  await page.screenshot({ path: resolve(shotDir, `boot-${theme}.png`) });
  await page.close();
}

// 无障碍：`prefers-reduced-motion: reduce` 下那条不停扫的进度条必须静止。
// 全项目本来一处 reduced-motion 都没有（体验复核 U-09），至少首帧这一处不能漏。
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/\/assets\/.*\.js(\?|$)/.test(req.url())) void req.abort();
    else void req.continue();
  });
  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 30_000 });
  const rm = await page.evaluate(() => {
    const bar = document.querySelector('.boot-bar');
    if (!bar) return null;
    const after = getComputedStyle(bar, '::after');
    return { display: after.display, width: after.width, barWidth: getComputedStyle(bar).width };
  });
  // reduced-motion 下**不留扫光**：只留空槽。满宽实心条会被读成 100%（比 38% 更像"完成了"），
  // 空槽读作"在装、不给承诺"，与 indeterminate 的语义一致。
  check(rm?.display === 'none', '[reduced-motion] 扫光那一段已移除', String(rm?.display));
  check(
    rm != null && Math.round(parseFloat(rm.barWidth)) === 88,
    '[reduced-motion] 空槽仍在（88px），不是一片空白',
    rm ? String(rm.barWidth) : 'none',
  );
  await page.close();
}

// 回归：正常加载后骨架必须被真页面顶掉。
// 判据用 `.welcome, .hdr`（引导页 / 今日页）而不是 `.app` —— `.app` 在
// 「正在准备本地数据…」这一屏就已经有了，等它等于什么都没验：
// 骨架换成加载态也算「通过」，而 bootstrap 卡死同样算「通过」。
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.welcome, .hdr', { timeout: 60_000 });
  const after = await page.evaluate(() => ({
    boot: !!document.querySelector('#root .boot'),
    content: !!document.querySelector('.welcome, .hdr'),
  }));
  check(!after.boot, '加载完成后骨架已被替换（不会永久挂着）');
  check(after.content, '加载完成后真页面已渲染（引导页或今日页）');
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.error('失败项：');
  for (const f of failed) console.error(` - ${f.label} ${f.extra}`);
  process.exit(1);
}
