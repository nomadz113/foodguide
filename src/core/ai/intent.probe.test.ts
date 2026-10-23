/**
 * 意图解析验收 —— 用 20 条人工语料跑**真实模型**，逐条比对 type 与关键字段。
 *
 * 为什么写在 vitest 里而不是 tools/*.mjs：
 * 该模块有相对导入，Node 的 --experimental-strip-types 不解析无扩展名的相对路径，
 * 直接 node 跑会 ERR_MODULE_NOT_FOUND。vitest 走 Vite 的解析器，没有这个问题。
 *
 * 默认跳过（一次 20 个请求会给 npm test 拖慢 1 分钟并花钱）。
 * 手动跑：INTENT_PROBE=1 npx vitest run src/core/ai/intent.probe.test.ts
 *
 * 验收线（方案 §14）：意图分类准确 ≥90%；"记住…320 大卡"必须解析成
 * create_food + per_serving + serving.grams 有值。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTENT_SYSTEM_PROMPT, parseIntent, type Intent } from './intent';

const RUN = process.env.INTENT_PROBE === '1';

function loadKey(): string | null {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq < 0) continue;
      if (s.slice(0, eq).trim() === 'DASHSCOPE_API_KEY') {
        return s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* 没文件就走跳过分支 */
  }
  return null;
}

const KEY = loadKey();
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen-plus';
const TODAY = '2026-10-22';

interface Case {
  text: string;
  /** 允许多个可接受标签（如 smalltalk | unknown 对产物没有区别） */
  type: Intent['type'] | Intent['type'][];
  /** 返回 null 表示通过，返回字符串表示失败原因 */
  check: (i: Intent) => string | null;
}

const ok = () => null;

const CASES: Case[] = [
  {
    text: '记住，我妈做的红烧肉，一碗大概 320 大卡，蛋白质 18g、脂肪 22g、碳水 15g',
    type: 'create_food',
    check: (i) => {
      if (i.food?.nutritionBasis !== 'per_serving') return 'basis 应为 per_serving';
      if (!((i.food?.serving?.grams ?? 0) > 0)) return 'serving.grams 缺失';
      if (i.food?.values?.kcal !== 320) return `kcal 应为 320，实际 ${i.food?.values?.kcal}`;
      if (i.food?.values?.protein !== 18) return 'protein 应为 18';
      return null;
    },
  },
  {
    text: '记住这个：楼下那家牛肉粉，一份 550 大卡，蛋白 28 克，脂肪 18 克，碳水 62 克',
    type: 'create_food',
    check: (i) => (i.food?.nutritionBasis === 'per_serving' ? null : 'basis 应为 per_serving'),
  },
  {
    text: '每 100 克燕麦棒大概 380 大卡，蛋白 12 克，脂肪 10 克，碳水 60 克',
    type: 'create_food',
    check: (i) => {
      if (i.food?.nutritionBasis !== 'per_100g') return 'basis 应为 per_100g';
      if (i.food?.values?.kcal !== 380) return 'kcal 应为 380';
      return null;
    },
  },
  {
    text: '帮我改一下「妈妈牌红烧肉」，现在一碗算 350 大卡',
    type: 'update_food',
    check: (i) => (i.food?.values?.kcal === 350 ? null : `kcal 应为 350，实际 ${i.food?.values?.kcal}`),
  },
  {
    text: '把「妈妈牌红烧肉」删掉',
    type: 'delete_food',
    check: (i) => (i.target?.name?.includes('红烧肉') ? null : `target.name 应含红烧肉`),
  },
  {
    text: '今天中午吃了番茄炒蛋和一碗米饭',
    type: 'log_meal',
    check: (i) => {
      if (i.meal?.slot !== 'lunch') return `slot 应为 lunch，实际 ${i.meal?.slot}`;
      if ((i.meal?.items?.length ?? 0) < 2) return '至少应有 2 项';
      if (i.meal.items.some((it) => !(it.grams > 0))) return '有项缺 grams';
      return null;
    },
  },
  {
    text: '早上吃了两个鸡蛋和一杯豆浆',
    type: 'log_meal',
    check: (i) => (i.meal?.slot === 'breakfast' ? null : `slot 应为 breakfast`),
  },
  {
    text: '刚才喝了一瓶可乐',
    type: 'log_meal',
    check: (i) => ((i.meal?.items?.length ?? 0) >= 1 ? null : '至少应有 1 项'),
  },
  {
    text: '昨天晚饭吃了火锅，牛肉片大概 200 克，还有土豆和青菜',
    type: 'log_meal',
    check: (i) => {
      if (i.meal?.date !== '2026-10-21') return `date 应为 2026-10-21，实际 ${i.meal?.date}`;
      if (i.meal?.slot !== 'dinner') return `slot 应为 dinner，实际 ${i.meal?.slot}`;
      return null;
    },
  },
  { text: '今天吃了多少卡？', type: 'query_stats', check: ok },
  {
    text: '红烧肉多少卡？',
    type: 'query_food',
    check: (i) => ((i.target?.name || i.food?.name)?.includes('红烧肉') ? null : '应带出食物名'),
  },
  { text: '这周热量超了吗', type: 'query_stats', check: ok },
  { text: '你好呀', type: ['smalltalk', 'unknown'], check: ok },
  {
    // 无关话题归 smalltalk 还是 unknown 对产物没有任何影响 —— 两者都只渲染成一句普通回复，
    // 不写库、不弹卡。所以只要不误判成"要记账"就算对，不在这两个标签之间较劲。
    text: '今天天气不错',
    type: ['smalltalk', 'unknown'],
    check: ok,
  },
  {
    text: '记住，我家的米饭是一碗 200 克，200 大卡',
    type: 'create_food',
    check: (i) => {
      if (i.food?.serving?.grams !== 200) return `grams 应为 200，实际 ${i.food?.serving?.grams}`;
      if (i.food?.values?.protein != null) return '用户没说蛋白，不该编';
      return null;
    },
  },
  {
    text: '我晚上吃了一碗面条，大概 400 大卡',
    type: 'log_meal',
    check: (i) => (i.meal?.slot === 'dinner' ? null : `slot 应为 dinner`),
  },
  {
    text: '以后我说的「奶茶」都按一杯 350 大卡算',
    type: 'create_food',
    check: (i) => (i.food?.nutritionBasis === 'per_serving' ? null : 'basis 应为 per_serving'),
  },
  {
    text: '记住，一个鸡蛋大概 70 大卡',
    type: 'create_food',
    check: (i) => ((i.food?.serving?.grams ?? 0) >= 40 ? null : `一个鸡蛋 grams 太小：${i.food?.serving?.grams}`),
  },  { text: '把今天中午那一餐删掉', type: 'delete_meal', check: ok },
  { text: '我的目标热量是多少', type: 'query_stats', check: ok },
];

async function call(text: string) {
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
  const j = JSON.parse(raw) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    intent: parseIntent(JSON.parse(j.choices?.[0]?.message?.content ?? '{}')),
    inTok: j.usage?.prompt_tokens ?? 0,
    outTok: j.usage?.completion_tokens ?? 0,
  };
}

describe.skipIf(!RUN || !KEY)('意图语料验收（真实模型 qwen-plus）', () => {
  it('20 条语料意图分类准确率 ≥90%', async () => {
    const failures: string[] = [];
    let inTok = 0;
    let outTok = 0;

    for (let i = 0; i < CASES.length; i++) {
      const c = CASES[i]!;
      const n = String(i + 1).padStart(2, '0');
      try {
        const r = await call(c.text);
        inTok += r.inTok;
        outTok += r.outTok;
        const acceptable = Array.isArray(c.type) ? c.type : [c.type];
        const reason = !acceptable.includes(r.intent.type)
          ? `type 应为 ${acceptable.join(' | ')}，实际 ${r.intent.type}`
          : c.check(r.intent);
        if (reason) {
          failures.push(
            `${n} 「${c.text}」→ ${reason}\n     实际 ${JSON.stringify({
              type: r.intent.type,
              basis: r.intent.food?.nutritionBasis,
              serving: r.intent.food?.serving,
              values: r.intent.food?.values,
              slot: r.intent.meal?.slot,
              date: r.intent.meal?.date,
              items: r.intent.meal?.items?.map((it) => `${it.name} ${it.grams}g`),
            })}`,
          );
        } else {
          console.log(`✓ ${n} ${r.intent.type}`);
        }
      } catch (e) {
        failures.push(`${n} 「${c.text}」调用异常: ${e instanceof Error ? e.message : e}`);
      }
    }

    const total = CASES.length;
    const pass = total - failures.length;
    console.log(`\n准确率 ${pass}/${total} = ${((pass / total) * 100).toFixed(1)}%`);
    console.log(`token 输入 ${inTok} / 输出 ${outTok}，成本 ≈ ¥${((inTok * 0.8 + outTok * 2) / 1e6).toFixed(4)}`);
    if (failures.length) console.log('\n失败项：\n' + failures.join('\n'));

    expect(pass / total).toBeGreaterThanOrEqual(0.9);
  }, 240_000);
});
