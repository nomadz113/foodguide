/**
 * 生成「0.8.0 → 0.8.8 升级说明」竖版长图（浅色），用来发微信。
 *
 * 与 make-changelog-card.mjs 的区别：那张是 0.1→0.8 八个主版本的「全记录」，
 * 这张只讲 0.8 系列内部的变化 —— 给已经装了 0.8.0 的人看「升级之后多了什么」。
 *
 * **按功能分块，不按版本罗列**。九个补丁版里有一半只是内部改动，
 * 逐个列出来会把真正值得说的东西淹没。所以这里把九版归并成六条主线，
 * 版本号只作为小徽章标在块上（用户想查某个功能是哪版加的，仍然查得到）。
 *
 * 内容全部来自 .workbuddy/memory/ 的开发日志，只写**用户能感知到**的变化：
 * 内部重构、chunk 清理、构建戳、探针断言一律不写。
 *
 * 高度不写死：内容多少由 BLOCKS 决定，用 fullPage 截图自动撑开。
 *
 * 用法：node tools/make-patch-card.mjs
 * 产出：../../更新说明-0.8.0-0.8.8-浅色.png
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = resolve(import.meta.dirname, '../../更新说明-0.8.0-0.8.8-浅色.png');
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
  greenBg: 'rgba(21,128,61,.10)',
  greenSoft: 'rgba(21,128,61,.14)',
};

/**
 * 六条主线。badge 是版本范围（想查细节的人能对上号），不是标题。
 * tone 决定徽章底色 —— 全用品牌绿，因为它们都属于这一次更新；
 * 用不同色区分「哪几个是大改动」的信息在按功能分块后已经不存在了。
 */
const BLOCKS = [
  {
    no: '01',
    badge: '0.8.0',
    title: '体脂秤',
    items: [
      '从 Keep 的截图识别体重和体脂率，磅会自动换成公斤',
      '保存前先告诉你每日热量目标会怎么变，你确认了才记',
      '补录几天前的截图只进趋势，不会改档案里的「当前体重」',
      '截图只印了日期没印几点时，用截图时间补上，不再是 0 点 0 分',
    ],
  },
  {
    no: '02',
    badge: '0.8.4',
    title: '食物库翻倍',
    items: [
      '食物库从 80 条扩到 174 条，家常菜基本都能搜到',
      '冬瓜、黄豆芽、绿豆芽、小白菜这几条的数字按中国食物成分表重算过 —— 原来用的是国外口径',
      '「鱼」「粉」「糖」这类单字别名删掉了，它们会把草鱼、粉丝、白糖一起吃掉；换成「鸡大胸」「牛里脊」这种口语叫法',
      '维生素 E 的覆盖率从 87% 补到 92%',
    ],
  },
  {
    no: '03',
    badge: '0.8.5',
    title: '搜不到的能自己补',
    items: [
      '新增「库缺口」页面：拍照和搜索都没找到的食物，可以直接加进食物库',
      '分「食材 / 菜品 / 已忽略」三栏。菜品默认不入册 —— 同名菜做法不一样，存成固定值反而是错的',
      '你手动纠正过的叫法会被记住，下次同一个菜直接认出来',
      '只记真正没找到的：已经能搜到的不会来打扰你',
    ],
  },
  {
    no: '04',
    badge: '0.8.1 – 0.8.3',
    title: '看得更清楚',
    items: [
      '血压统计页重排：先看每日平均曲线，再看今天最后一次读数',
      '改一餐时，每项食物下面多一行矿物质小标签',
      '整餐的矿物质汇总成六格，带占比和进度条',
      '逐项文字固定第一行 5 项、第二行 1 项，屏幕再窄也不会折成 4+2',
    ],
  },
  {
    no: '05',
    badge: '0.8.6 – 0.8.7',
    title: '首页重排',
    items: [
      '血压卡和「晨峰 / 晚峰」一起挪到「今日记录」下面',
      '首页顺序变成：宏量 → 钠 → 微量 → 建议 → 今日记录 → 血压 → 晨峰 / 晚峰',
      '回顾型的数字不占首屏 —— 要看今天的数据，一打开就在眼前',
    ],
  },
  {
    no: '06',
    badge: '0.8.8',
    title: '全新启动画面',
    items: [
      '换了一整块启动画面：原来的 logo 保留，加上一句「每日饮食，轻松指南」',
      '三件事一眼看懂：拍照记录 → AI 识别 → 健康建议',
      '加了心电波形、点阵网格、离线说明这些健康与生活的元素',
      '深浅两套配色各自调过，白底和黑底都不会糊',
    ],
  },
];

const card = (b) => `<div class="row">
  <div class="node"><span>${b.no}</span></div>
  <div class="card">
    <div class="chead">
      <span class="badge">${b.badge}</span>
      <span class="ctitle">${b.title}</span>
    </div>
    <ul>${b.items.map((i) => `<li>${i}</li>`).join('')}</ul>
  </div>
</div>`;

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

  .list { margin-top: 52px; display: flex; flex-direction: column; gap: 22px; position: relative; }
  /* 左栏的连接线：穿过序号圆的中心（圆直径 56，左边距 28） */
  .list::before {
    content: ""; position: absolute; left: 28px; top: 28px; bottom: 28px;
    width: 3px; background: ${T.rail}; border-radius: 2px;
  }

  .row { display: flex; gap: 26px; align-items: flex-start; }
  .node {
    width: 56px; height: 56px; flex: none; border-radius: 50%;
    background: linear-gradient(135deg, #4ade80, #16a34a);
    color: #fff; font-size: 22px; font-weight: 800; letter-spacing: .02em;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(21,128,61,.28);
    z-index: 1;
  }

  .card {
    flex: 1; min-width: 0;
    background: ${T.card}; border: 1px solid ${T.line}; border-radius: 24px;
    padding: 30px 38px 32px;
    box-shadow: 0 1px 3px rgba(15,23,42,.08);
  }

  .chead { display: flex; align-items: center; gap: 14px; }
  /* 版本号做成行内小标签，不占固定位 —— 标签长度不一也不会把标题顶歪 */
  .badge {
    flex: none;
    font-size: 20px; font-weight: 800; padding: 5px 13px; border-radius: 9px;
    letter-spacing: .02em; font-variant-numeric: tabular-nums;
    color: ${T.green}; background: ${T.greenBg};
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

  <h1>和你有关的六件事</h1>
  <div class="sub">从 <b>0.8.0</b> 到 <b>0.8.8</b>，其余都是内部改动</div>
  <div class="list">${BLOCKS.map(card).join('')}</div>

  <div class="foot">
    <span>记录只存在手机本地 · 不保存照片</span>
    <span class="tag">好好吃饭 · 0.8.0 → 0.8.8</span>
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
  // 高度由内容决定：fullPage 会自己撑开。clip 与 fullPage 互斥，只能给 fullPage
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const buf = await page.screenshot({ type: 'png', fullPage: true });
  writeFileSync(OUT, buf);
  console.log(`完成：${OUT}（${(buf.length / 1024).toFixed(0)} KB，${W}×${h}）`);
} finally {
  await browser.close();
}
