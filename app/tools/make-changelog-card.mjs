/**
 * 生成「0.1 → 0.8 全部更新」竖版长图（浅色），用来发微信。
 *
 * 与 make-update-card.mjs 的区别：那张只说 0.7/0.8 两个新功能，
 * 这张是版本全记录 —— 8 个主版本 + 期间每个补丁版，按时间轴排。
 *
 * 内容全部来自 .workbuddy/memory/ 里的开发日志，逐条对照过发布日期，
 * 不写日志里没有的功能；被回退掉的改动（0.5.2 的 Web 启动壳）不列入。
 *
 * 高度不写死：内容多少由 cards 决定，用 fullPage 截图自动撑开。
 * 写死高度的话，以后加一条就要重新算一遍边距。
 *
 * 用法：node tools/make-changelog-card.mjs
 * 产出：../../更新说明-0.1-0.8-浅色.png
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = resolve(import.meta.dirname, '../../更新说明-0.1-0.8-浅色.png');
const W = 1080;

/** 配色取自 App 的浅色主题（index.css :root[data-theme='light']），不是凭眼睛挑的 */
const T = {
  bg: '#f4f6fa',
  card: '#ffffff',
  line: '#dde3ec',
  lineSoft: '#e6ebf2',
  fg: '#0f172a',
  dim: '#475569',
  mute: '#5b6b80',
  rail: '#d8dfe9',
  green: '#15803d',
  purple: '#6d28d9',
  slateBg: 'rgba(15,23,42,.06)',
  greenBg: 'rgba(21,128,61,.10)',
  purpleBg: 'rgba(109,40,217,.10)',
};

/**
 * 每个版本：版本号、一句话标题、用户能感觉到的条目、补丁版说明。
 * tone 决定强调色 —— 只有 0.7 / 0.8 上彩色，其余走中性灰：
 * 全部上色会让「哪两个是新功能」这个信息消失。
 */
const VERSIONS = [
  {
    v: '0.1',
    tone: 'slate',
    title: '第一次装上就能用',
    items: [
      '拍一张饭菜照片，自动认出是什么菜、算出 19 项营养素',
      '份量分小、中、大三档，点一下就能改',
      '一句话记账：「中午吃了两个鸡蛋一杯牛奶」',
      '每天给建议，周、月、季各出一份报告',
    ],
    patch: '0.1.1 · 华为手机点拍照只弹相册、打不开相机 —— 修好了',
  },
  {
    v: '0.2',
    tone: 'slate',
    title: '装一次，以后不用重装',
    items: [
      '换成在线版：程序更新后打开就是新的，不用再找安装包',
      '断网时也能打开界面，已记的餐不会白丢',
    ],
  },
  {
    v: '0.3',
    tone: 'slate',
    title: '打开少一道坎',
    items: [
      '新增一个托管入口：不再弹「继续访问」的中间页',
      '凭证过期不再是白屏，仍能打开记一餐',
    ],
  },
  {
    v: '0.4',
    tone: 'slate',
    title: '数据能带走了',
    items: [
      '设置里加「导出备份 / 导入备份」：换手机、换安装包，记录都搬得过去',
      '同一份备份导两次，记录不会翻倍',
    ],
    patch: '0.4.1 · 修掉「导出点了没反应」；圆环里的数字挪回正中间',
  },
  {
    v: '0.5',
    tone: 'slate',
    title: '记错了能改',
    items: [
      '蛋白、脂肪、碳水三条进度条回来了',
      '点任意一餐进去改克数、改份量、改时间，不用删了重记',
      '改克数时营养值跟着重算，不会出现「300 克 / 150 千卡」这种矛盾',
    ],
    patch: '0.5.1 · 键盘弹起时，输入框不再被盖住',
  },
  {
    v: '0.6',
    tone: 'slate',
    title: '启动和手感',
    items: [
      '启动屏带上名字，不再是干等白屏',
      '键盘和手机底部手势条都不再压住界面',
      '身高体重这类数字终于能删干净（以前删到最后会变成 0）',
      '换了自己的图标和转圈轨道，顺带修掉 logo 之后黑屏',
      '加入浅色主题，跟着手机系统自动切换',
    ],
    patch: '0.6.1 → 0.6.8 · 一共八个小版本，键盘、手势条、启动屏各修了好几轮',
  },
  {
    v: '0.7',
    tone: 'purple',
    title: '血压',
    items: [
      '拍血压计的屏幕，自动读出高压、低压和脉搏',
      '立刻判断等级：正常、偏高还是几级高血压，按颜色区分',
      '单位是 kPa 自动换算，读数明显不对会提示你核对，不帮你改',
      '趋势图带 140/90 目标线，没测的日子曲线断开，不假装有数据',
      '一段时间看平均、达标率、最高最低，还有早上和晚上的对比',
    ],
    patch: '0.7.1 · 血压并进「统计」，和饮食数据点一下切换；首页加了晨晚血压卡',
  },
  {
    v: '0.8',
    tone: 'green',
    title: '体脂秤',
    items: [
      '从 Keep 的截图识别体重和体脂率，磅会自动换成公斤',
      '保存前先告诉你每日热量目标会怎么变，你确认了才记',
      '补录三天前的截图只进趋势，不会改档案里的「当前体重」',
      '截图只印了日期没印几点时，用截图时间补上，不再是 0 点 0 分',
    ],
  },
];

const accent = (tone) =>
  tone === 'purple'
    ? { c: T.purple, bg: T.purpleBg }
    : tone === 'green'
      ? { c: T.green, bg: T.greenBg }
      : { c: T.fg, bg: T.slateBg };

const card = (v) => {
  const a = accent(v.tone);
  return `<div class="row ${v.tone}">
    <div class="rail"><span class="dot"></span></div>
    <div class="card">
      <div class="chead">
        <span class="badge" style="color:${a.c};background:${a.bg}">${v.v}</span>
        <span class="ctitle">${v.title}</span>
      </div>
      <ul>${v.items.map((i) => `<li>${i}</li>`).join('')}</ul>
      ${v.patch ? `<div class="patch">${v.patch}</div>` : ''}
    </div>
  </div>`;
};

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${W}px;
    background: ${T.bg};
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
    color: ${T.fg};
    background-image:
      radial-gradient(900px 460px at 86% -6%, rgba(21,128,61,.07), transparent 70%),
      radial-gradient(700px 420px at 4% 103%, rgba(109,40,217,.05), transparent 70%);
  }
  .wrap { padding: 72px 64px 60px; }

  .brand { display: flex; align-items: center; gap: 16px; }
  .logo {
    width: 56px; height: 56px; border-radius: 16px;
    background: linear-gradient(135deg, #4ade80, #22c55e);
    color: #06210f; font-size: 30px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .brandname { font-size: 28px; color: ${T.dim}; letter-spacing: .12em; }

  h1 { font-size: 78px; font-weight: 800; letter-spacing: .02em; margin-top: 34px; line-height: 1.12; }
  .sub { margin-top: 18px; font-size: 29px; color: ${T.dim}; line-height: 1.5; }
  .sub b { color: ${T.fg}; font-weight: 700; }

  .list { margin-top: 52px; display: flex; flex-direction: column; gap: 22px; }

  /* 时间轴：竖线画在 .rail 里，圆点压在线上。卡片刻意不覆盖竖线，视觉上才连成一条 */
  .row { display: flex; gap: 24px; }
  .rail { width: 26px; flex: none; position: relative; }
  .rail::before {
    content: ""; position: absolute; left: 11px; top: 0; bottom: -22px;
    width: 3px; background: ${T.rail};
  }
  .row:last-child .rail::before { bottom: 40%; }
  /* top 是按「卡片上内距 30 + 徽章高一半」量的，让圆点与版本号同一水平线。
     凭感觉给的 40px 会偏高 8px，一眼看不出来但整列读着别扭 */
  .rail .dot {
    position: absolute; left: 4px; top: 46px;
    width: 17px; height: 17px; border-radius: 50%;
    background: #fff; border: 3px solid ${T.rail};
  }
  .purple .dot { border-color: ${T.purple}; }
  .green .dot { border-color: ${T.green}; }

  .card {
    flex: 1; min-width: 0;
    background: ${T.card}; border: 1px solid ${T.line}; border-radius: 24px;
    padding: 34px 38px 30px;
    box-shadow: 0 1px 3px rgba(15,23,42,.08);
  }
  /* 左侧一道强调色，只有 0.7/0.8 有；其余版本保持干净 */
  .purple .card, .green .card { position: relative; overflow: hidden; }
  .purple .card::before, .green .card::before {
    content: ""; position: absolute; left: 0; top: 30px; bottom: 30px; width: 5px;
    border-radius: 0 5px 5px 0;
  }
  .purple .card::before { background: ${T.purple}; }
  .green .card::before { background: ${T.green}; }

  .chead { display: flex; align-items: center; gap: 16px; }
  .badge {
    font-size: 25px; font-weight: 800; padding: 6px 16px; border-radius: 10px;
    letter-spacing: .04em; font-variant-numeric: tabular-nums;
  }
  .ctitle { font-size: 37px; font-weight: 700; }

  ul { margin-top: 20px; display: flex; flex-direction: column; gap: 13px; list-style: none; }
  li {
    font-size: 27px; line-height: 1.58; color: ${T.dim}; padding-left: 26px; position: relative;
  }
  li::before {
    content: ""; position: absolute; left: 2px; top: 16px;
    width: 8px; height: 8px; border-radius: 50%; background: #9aa8ba;
  }
  .purple li::before { background: ${T.purple}; }
  .green li::before { background: ${T.green}; }

  .patch {
    margin-top: 20px; padding-top: 16px; border-top: 1px dashed ${T.lineSoft};
    font-size: 24px; color: ${T.mute}; line-height: 1.5;
  }

  .foot {
    margin-top: 52px; padding-top: 34px;
    border-top: 1px solid ${T.line};
    font-size: 24px; color: ${T.mute};
    display: flex; justify-content: space-between; align-items: center;
  }
  .foot .tag { color: ${T.dim}; font-weight: 700; }
</style></head>
<body><div class="wrap">

  <div class="brand">
    <div class="logo">日</div>
    <div class="brandname">好好吃饭</div>
  </div>

  <h1>八次更新</h1>
  <div class="sub">从 <b>0.1</b> 到 <b>0.8</b>，这个 App 到现在走过的全部路</div>

  <div class="list">${VERSIONS.map(card).join('')}</div>

  <div class="foot">
    <span>记录只存在手机本地 · 不保存照片</span>
    <span class="tag">好好吃饭 · 0.1 → 0.8</span>
  </div>

</div></body></html>`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: 1200, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  // 字体加载完再截，否则中文可能落到后备字体上，字重会不一样
  await page.evaluate(() => document.fonts.ready);
  // 高度由内容决定：fullPage 会自己撑开，不用先算。clip 与 fullPage 互斥，只能给 fullPage
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const buf = await page.screenshot({ type: 'png', fullPage: true });
  writeFileSync(OUT, buf);
  console.log(`完成：${OUT}（${(buf.length / 1024).toFixed(0)} KB，${W}×${h}）`);
} finally {
  await browser.close();
}
