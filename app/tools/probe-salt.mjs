/**
 * 「盐必须单列」这条提示词规则在真实模型上到底灵不灵 —— 真实 API 验收。
 *
 * 单测只能证明 fillMicro 会兜底、withSaltTier 会缩放，证明不了模型肯不肯吐出「食盐」这一条。
 * 而整条修复链的前提就是"模型照规矩把盐单列出来"。
 *
 * 三个方向都要钉住：
 * 1. 说「吃了 2g 食盐」→ 必须有一条 2g 的盐（这就是用户报的那个 bug 原场景）
 * 2. 正餐要按做法给量，且**成菜 per100g 的钠里不许再含盐**（否则翻倍）
 * 3. 清淡的菜要给得少，不能一律 3.5g
 *
 * 用法：node tools/probe-salt.mjs
 */
import { createServer } from 'vite';
import { loadEnv } from './env.mjs';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { INTENT_SYSTEM_PROMPT, parseIntent } = await vite.ssrLoadModule('/src/core/ai/intent.ts');

const env = loadEnv();
const KEY = env.DASHSCOPE_API_KEY;
const BASE = env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = env.TEXT_MODEL || 'qwen-plus';
const TODAY = '2026-10-28';

if (!KEY) {
  console.error('缺 DASHSCOPE_API_KEY（app/.env.local）');
  process.exit(1);
}

const isSalt = (n) => /盐/.test(n);
const saltTotal = (items) => items.filter((i) => isSalt(i.name)).reduce((a, s) => a + Number(s.grams || 0), 0);
const OIL = /大豆油|食用油|植物油|花生油|菜籽油|调和油|玉米油|橄榄油|葵花籽油/;
const oilTotal = (items) => items.filter((i) => OIL.test(i.name)).reduce((a, s) => a + Number(s.grams || 0), 0);
/** 整条成菜的油不单列，藏在它自己的 per100g.fat 里 —— 所以「油有没有丢」要看脂肪总量 */
const fatTotal = (items) =>
  items.reduce((a, i) => a + (Number(i.grams || 0) * Number(i.per100g?.fat ?? 0)) / 100, 0);

const CASES = [
  {
    text: '吃了2g食盐',
    why: '一条 2g 的盐，这就是用户报的那个场景',
    check: (items) => {
      const s = items.filter((i) => isSalt(i.name));
      return s.length >= 1 && Math.abs(Number(s[0].grams) - 2) <= 0.6;
    },
  },
  {
    text: '中午吃了红烧肉一份大概250克，清炒青菜一盘200克，米饭一碗150克',
    why: '盐要单列、合计 2~7g（红烧 3.5 + 清炒 2），且成菜 per100g 的钠不许再含盐',
    check: (items) => {
      const total = saltTotal(items);
      const meat = items.find((i) => i.name.includes('红烧肉'));
      const meatNa = meat?.per100g?.sodium ?? 0;
      return total >= 2 && total <= 7 && meatNa > 0 && meatNa < 700;
    },
  },
  {
    text: '晚上吃了清蒸鲈鱼一条300克，白灼虾10只',
    why: '两个清淡菜，合计 1~3g，不许一律按重口给',
    check: (items) => {
      const total = saltTotal(items);
      return total >= 1 && total <= 3;
    },
  },
  {
    text: '早餐吃了两个煎蛋',
    why: '煎要有独立的油条目（6g 档），以前文本路径缺这一档会漏油或错记成清炒 8g',
    check: (items) => {
      const oil = oilTotal(items);
      return oil >= 4 && oil <= 16;
    },
  },
  {
    text: '家里炒了一大锅青菜，一共大概600克，我吃了三分之一',
    why: '合餐：grams 必须记整份 600（不许自己除成 200），share 给 0.33，折算交给代码',
    check: (items, i) => {
      const greens = items.find((it) => it.name.includes('青菜'));
      const share = i.meal?.share ?? 1;
      return (greens?.grams ?? 0) >= 500 && share <= 0.45;
    },
  },
  {
    text: '中午吃了120克清炒小白菜',
    why: '盐按菜重×密度算，120g 小份不该拿「一盘」的 2g（那样密度 1.7g/100g 比红烧还咸）',
    check: (items) => {
      const salt = saltTotal(items);
      return salt >= 0.6 && salt <= 1.6;
    },
  },
  {
    text: '一个人吃了碗牛肉面',
    why: '单人餐不许乱填 share —— 填 0.33 会把这碗面抹成三分之一',
    check: (items, i) => {
      const share = i.meal?.share ?? 1;
      return share >= 0.9;
    },
  },
];

async function call(text) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: `今天是 ${TODAY}。\n\n用户说：${text}` },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${raw.slice(0, 200)}`);
  const j = JSON.parse(raw);
  return parseIntent(JSON.parse(j.choices?.[0]?.message?.content ?? '{}'));
}

let fail = 0;
for (const c of CASES) {
  try {
    const i = await call(c.text);
    const items = i.meal?.items ?? [];
    const ok = c.check(items, i);
    if (!ok) fail++;
    const line = items
      .map((it) => `${it.name} ${it.grams}g(钠 ${it.per100g?.sodium ?? '∅'})`)
      .join(' + ');
    console.log(`${ok ? '✓' : '✗'} 「${c.text}」`);
    console.log(`   ${line || '(无 items)'}`);
    console.log(`   share=${i.meal?.share ?? '∅'} | 盐 ${saltTotal(items)}g / 油 ${oilTotal(items)}g / 脂肪 ${fatTotal(items).toFixed(1)}g —— ${c.why}`);
    if (!ok) console.log('   ↑ 不符合预期');
  } catch (e) {
    fail++;
    console.log(`✗ 「${c.text}」调用异常: ${e instanceof Error ? e.message : e}`);
  }
}

await vite.close();
console.log(`\n${CASES.length - fail}/${CASES.length} 通过`);
process.exit(fail === 0 ? 0 : 1);
