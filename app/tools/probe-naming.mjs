/**
 * 「name 不许带做法前缀」这条提示词规则到底灵不灵 —— 真实模型验收。
 *
 * 为什么要单独验：单测只能证明 findSuffixMatch 能接住「无油煎鸡胸肉」，
 * 证明不了模型会不会照规矩把它写成「鸡胸肉」。而这条规则是方案 2 的全部前提。
 *
 * 两个方向都要钉住：
 * - 该洗的必须洗掉（无油煎鸡胸肉 → 鸡胸肉）
 * - 不该洗的不许洗（番茄炒蛋不许被拆成「番茄」「鸡蛋」，那是另一条规则管的）
 *
 * 用法：node tools/probe-naming.mjs
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

// `want` 是 name 里**必须出现**的词；`forbid` 是**绝不能出现**的做法前缀
const CASES = [
  { text: '无油煎鸡胸肉吃了100克。', want: '鸡胸肉', forbid: '无油煎' },
  { text: '无油煎鸡排，150克。', want: '鸡胸肉', forbid: '无油煎' },
  { text: '空气炸鸡腿 200g', want: '鸡腿', forbid: '空气炸' },
  { text: '水煮蛋两个', want: '鸡蛋', forbid: '水煮' },
  { text: '今天中午吃了番茄炒蛋和一碗米饭', want: '番茄炒蛋', forbid: null },
  { text: '晚上吃了清蒸鲈鱼一条，大概 300 克', want: '鲈鱼', forbid: '清蒸' },
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
    const names = (i.meal?.items ?? []).map((it) => it.name);
    const joined = names.join('+');
    const miss = !joined.includes(c.want);
    const dirty = c.forbid ? joined.includes(c.forbid) : false;
    const ok = !miss && !dirty;
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} 「${c.text}」→ ${joined || '(无 items)'}${miss ? ` 缺「${c.want}」` : ''}${dirty ? ` 仍带「${c.forbid}」` : ''}`);
    if (!ok) console.log(`   per100g = ${JSON.stringify((i.meal?.items ?? []).map((it) => it.per100g))}`);
  } catch (e) {
    fail++;
    console.log(`✗ 「${c.text}」调用异常: ${e instanceof Error ? e.message : e}`);
  }
}

await vite.close();
console.log(`\n${CASES.length - fail}/${CASES.length} 通过`);
process.exit(fail === 0 ? 0 : 1);
