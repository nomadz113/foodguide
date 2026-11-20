/**
 * 「并列食材构词必须拆」提示词规则的真模型验收。
 *
 * 为什么单独验：probe 测试只断言 items ≥3 且不整条，证明不了拆出来的
 * **名字本身**能命中食物库 —— 拆成「猪里脊丝」这种带后缀的名字照样过不了
 * 0.62 阈值。所以这里把拆解产物直接喂给 findMatch，逐条核对命中。
 *
 * 两个方向都要钉住：
 * - A+B+C+炒式（≥3 个并列食材）必须拆，且拆出的名字要能命中库；
 * - 两食材组合（番茄炒蛋）不许被误拆 —— 那是库里有的成菜，整条才对。
 *
 * 用法：node tools/probe-split.mjs
 */
import { createServer } from 'vite';
import { loadEnv } from './env.mjs';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { INTENT_SYSTEM_PROMPT, parseIntent } = await vite.ssrLoadModule('/src/core/ai/intent.ts');
const { SEED_FOODS } = await vite.ssrLoadModule('/src/core/food/seed.ts');
const { findMatch } = await vite.ssrLoadModule('/src/core/food/match.ts');

const env = loadEnv();
const KEY = env.DASHSCOPE_API_KEY;
const BASE = env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = env.TEXT_MODEL || 'qwen-plus';
const TODAY = '2026-11-20';

if (!KEY) {
  console.error('缺 DASHSCOPE_API_KEY（app/.env.local）');
  process.exit(1);
}

/** want：拆解后必须出现的食材名；keep：必须保留的成菜名（对照组） */
const CASES = [
  {
    text: '今天中午吃了一盘青椒榨菜香干炒肉丝',
    split: true,
    want: ['青椒', '榨菜', '香干'],
    keep: null,
  },
  {
    text: '晚饭吃了土豆洋葱青椒炒牛肉，一盘',
    split: true,
    want: ['土豆', '洋葱', '青椒'],
    keep: null,
  },
  {
    text: '中午吃了番茄炒蛋和一碗米饭',
    split: false,
    want: null,
    keep: '番茄炒蛋',
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
    const names = items.map((it) => it.name);
    const joined = names.join('+');
    const problems = [];

    if (c.split) {
      if (names.length < 3) problems.push(`只拆出 ${names.length} 条`);
      if (joined.includes('青椒榨菜香干炒肉丝')) problems.push('整条输出，没拆');
      for (const w of c.want ?? []) {
        if (!names.some((n) => n.includes(w))) problems.push(`缺「${w}」`);
      }
      // 拆出的每条非油食材都要能命中库（油单独核：食用油/大豆油都收）
      for (const it of items) {
        const isOil = /油/.test(it.name) && !/蚝油|香油/.test(it.name);
        const hit = findMatch(it.name, SEED_FOODS);
        if (!isOil && !hit) problems.push(`「${it.name}」没命中库`);
      }
    } else {
      if (!joined.includes(c.keep)) problems.push(`「${c.keep}」被误拆了`);
    }

    const ok = problems.length === 0;
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} 「${c.text}」`);
    console.log(`   拆解 → ${joined || '(无 items)'}`);
    const hits = items
      .map((it) => {
        const h = findMatch(it.name, SEED_FOODS);
        return `${it.name} ${it.grams}g → ${h ? `${h.food.name}(${h.score.toFixed(2)})` : '未命中'}`;
      })
      .join(' | ');
    if (hits) console.log(`   匹配 → ${hits}`);
    for (const p of problems) console.log(`   ✗ ${p}`);
  } catch (e) {
    fail++;
    console.log(`✗ 「${c.text}」调用异常: ${e instanceof Error ? e.message : e}`);
  }
}

await vite.close();
console.log(`\n${CASES.length - fail}/${CASES.length} 通过`);
process.exit(fail === 0 ? 0 : 1);
