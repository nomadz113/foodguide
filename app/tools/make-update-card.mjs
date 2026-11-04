/**
 * 生成「功能更新」长图，用来发微信。深浅两版各出一张。
 *
 * 为什么不用 AI 生图：中文文案必须一字不差，AI 出的字经常糊。
 * 这里自己写 HTML + Edge 截图，文字、配色、间距全都可控，
 * 配色直接取自 App 的 index.css 两套主题变量 —— 图看起来是 App 的延伸而不是另贴一张海报。
 *
 * 浅色版不是把深色版反相：白底上 #4ade80 / #a78bfa 对比度只有 1.7 / 2.6，字会糊掉。
 * 所以用 App 浅色主题里那组 deepen 过的绿 #15803d、紫 #6d28d9（index.css:110,115）。
 *
 * 用法：node tools/make-update-card.mjs        （两张都出）
 *       node tools/make-update-card.mjs light  （只出浅色）
 * 产出：../../更新说明-0.7-0.8.png / 更新说明-0.7-0.8-浅色.png（1080×1440，微信发竖图不裁切）
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 1080;
/** 3:4 竖图，微信里发不裁切、不缩成小条 */
const H = 1440;

const THEMES = {
  dark: {
    file: '更新说明-0.7-0.8.png',
    label: '深色',
    bg: '#0b0e13',
    // 右上角一团极淡的光，避免整张图平得像截图
    glow: `radial-gradient(760px 420px at 82% -8%, rgba(74,222,128,.12), transparent 70%),
           radial-gradient(620px 380px at 6% 104%, rgba(167,139,250,.10), transparent 70%)`,
    card: '#151b24',
    line: '#242e3c',
    lineSoft: '#1d2530',
    fg: '#e9eef6',
    dim: '#8d99ab',
    mute: '#5d6878',
    brandColor: '#8d99ab',
    green: '#4ade80',
    purple: '#a78bfa',
    greenBg: 'rgba(74,222,128,.14)',
    purpleBg: 'rgba(167,139,250,.14)',
    shadow: 'none',
  },
  light: {
    file: '更新说明-0.7-0.8-浅色.png',
    label: '浅色',
    bg: '#f4f6fa',
    // 浅底上的光要更克制，否则像脏了；色相不变，只降透明度
    glow: `radial-gradient(760px 420px at 82% -8%, rgba(21,128,61,.07), transparent 70%),
           radial-gradient(620px 380px at 6% 104%, rgba(109,40,217,.06), transparent 70%)`,
    card: '#ffffff',
    line: '#dde3ec',
    lineSoft: '#e6ebf2',
    fg: '#0f172a',
    dim: '#475569',
    mute: '#5b6b80',
    brandColor: '#475569',
    green: '#15803d',
    purple: '#6d28d9',
    greenBg: 'rgba(21,128,61,.10)',
    purpleBg: 'rgba(109,40,217,.10)',
    // 白卡片浮在 #f4f6fa 上，没有阴影就分不清边界
    shadow: '0 1px 3px rgba(15,23,42,.10)',
  },
};

/** 文案只写一份，两版共用 —— 否则改一处漏一处，两张图说的话会不一样 */
const html = (t) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${W}px; height: ${H}px;
    background: ${t.bg};
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
    color: ${t.fg};
    background-image: ${t.glow};
  }
  .wrap { padding: 76px 64px 56px; height: ${H}px; display: flex; flex-direction: column; }

  .brand { display: flex; align-items: center; gap: 16px; }
  .logo {
    width: 56px; height: 56px; border-radius: 16px;
    background: linear-gradient(135deg, #4ade80, #22c55e);
    color: #06210f; font-size: 30px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .brandname { font-size: 28px; color: ${t.brandColor}; letter-spacing: .12em; }

  h1 { font-size: 88px; font-weight: 800; letter-spacing: .02em; margin-top: 36px; line-height: 1.1; }
  .sub { margin-top: 18px; font-size: 30px; color: ${t.dim}; }
  .sub b { font-weight: 700; }
  .sub .p { color: ${t.purple}; }
  .sub .g { color: ${t.green}; }

  .cards { margin-top: 56px; display: flex; flex-direction: column; gap: 28px; }

  .card {
    background: ${t.card}; border: 1px solid ${t.line}; border-radius: 28px;
    padding: 44px 40px 40px; position: relative; overflow: hidden;
    box-shadow: ${t.shadow};
  }
  /* 左侧竖条是这个区块的强调色：血压紫、体脂绿 */
  .card::before { content: ""; position: absolute; left: 0; top: 46px; bottom: 46px; width: 5px; border-radius: 0 5px 5px 0; }
  .v7::before { background: ${t.purple}; }
  .v8::before { background: ${t.green}; }

  .ctop { display: flex; align-items: center; gap: 18px; }
  .badge {
    font-size: 24px; font-weight: 700; padding: 8px 18px; border-radius: 10px;
    letter-spacing: .06em;
  }
  .v7 .badge { color: ${t.purple}; background: ${t.purpleBg}; }
  .v8 .badge { color: ${t.green}; background: ${t.greenBg}; }
  .ctitle { font-size: 42px; font-weight: 700; }
  .ico { margin-left: auto; width: 70px; height: 70px; }

  ul { margin-top: 30px; display: flex; flex-direction: column; gap: 24px; list-style: none; }
  li { font-size: 29px; line-height: 1.6; color: ${t.dim}; padding-left: 30px; position: relative; }
  li::before {
    content: ""; position: absolute; left: 4px; top: 15px;
    width: 9px; height: 9px; border-radius: 50%;
  }
  .v7 li::before { background: ${t.purple}; }
  .v8 li::before { background: ${t.green}; }
  li b { color: ${t.fg}; font-weight: 600; }

  .tip {
    margin-top: 44px; display: flex; align-items: center; justify-content: center; gap: 14px;
    font-size: 26px; color: ${t.mute};
  }
  .tip i { width: 10px; height: 10px; border-radius: 50%; background: ${t.green}; display: block; }
  .tip .k { color: ${t.dim}; }

  .foot {
    margin-top: auto; padding-top: 44px;
    border-top: 1px solid ${t.lineSoft};
    font-size: 24px; color: ${t.mute}; display: flex; justify-content: space-between; align-items: center;
  }
  .foot .tag { color: ${t.dim}; }
</style></head>
<body><div class="wrap">

  <div class="brand">
    <div class="logo">日</div>
    <div class="brandname">好好吃饭</div>
  </div>

  <h1>功能更新</h1>
  <div class="sub">两个新功能：<b class="p">血压</b> 和 <b class="g">体脂秤</b></div>

  <div class="cards">

    <div class="card v7">
      <div class="ctop">
        <div class="badge">0.7</div>
        <div class="ctitle">血压记录</div>
        <svg class="ico" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="29" r="21" stroke="${t.purple}" stroke-width="3.2"/>
          <path d="M18 33a14 14 0 0 1 28 0" stroke="${t.purple}" stroke-width="2.2" opacity=".45"/>
          <path d="M32 29l9.5-12" stroke="${t.purple}" stroke-width="3.2" stroke-linecap="round"/>
          <circle cx="32" cy="29" r="3.2" fill="${t.purple}"/>
          <path d="M32 50v5M25 55h14" stroke="${t.purple}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
        </svg>
      </div>
      <ul>
        <li><b>拍血压计屏幕</b>自动读出高压、低压、脉搏，不用手打</li>
        <li><b>自动判断等级</b>正常还是偏高，趋势图带 140/90 目标线</li>
        <li><b>并进「统计」里</b>和饮食数据点一下切换，首页看晨晚血压</li>
      </ul>
    </div>

    <div class="card v8">
      <div class="ctop">
        <div class="badge">0.8</div>
        <div class="ctitle">体脂秤记录</div>
        <svg class="ico" viewBox="0 0 64 64" fill="none">
          <rect x="7" y="17" width="50" height="32" rx="10" stroke="${t.green}" stroke-width="3.2"/>
          <rect x="20" y="26" width="24" height="14" rx="4" stroke="${t.green}" stroke-width="2.4" opacity=".55"/>
          <path d="M26 33h12" stroke="${t.green}" stroke-width="3" stroke-linecap="round"/>
          <circle cx="14.5" cy="33" r="2.6" fill="${t.green}" opacity=".55"/>
          <circle cx="49.5" cy="33" r="2.6" fill="${t.green}" opacity=".55"/>
        </svg>
      </div>
      <ul>
        <li><b>从 Keep 截图识别</b>体重、体脂率，磅自动换成公斤</li>
        <li><b>先告诉你后果</b>保存前就说清每日热量目标会怎么变</li>
        <li><b>补录旧记录不动档案</b>传三天前的截图只进趋势</li>
      </ul>
    </div>

  </div>

  <div class="tip">
    <i></i>
    <span>入口都在<span class="k">档案页</span>，体脂秤识别在「体重」那一栏下面</span>
  </div>

  <div class="foot">
    <span>记录只存在手机本地 · 不保存照片</span>
    <span class="tag">好好吃饭 · 0.7 / 0.8</span>
  </div>

</div></body></html>`;

const only = process.argv[2];
const targets = Object.entries(THEMES).filter(([k]) => !only || k === only);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  for (const [, t] of targets) {
    await page.setContent(html(t), { waitUntil: 'load' });
    // 字体加载完再截，否则中文可能落到后备字体上，字重会不一样
    await page.evaluate(() => document.fonts.ready);
    const out = resolve(import.meta.dirname, '../../', t.file);
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
    writeFileSync(out, buf);
    console.log(`${t.label}：${t.file}（${(buf.length / 1024).toFixed(0)} KB，${W}×${H}）`);
  }
} finally {
  await browser.close();
}
