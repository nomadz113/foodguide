/**
 * 视觉识别验证脚本。
 *
 * 用法：node tools/vision-probe.mjs <图片路径> [更多图片...]
 *
 * 目的不是"跑通"，而是让结果可评判：把模型拆出的每一项、克数、置信度、
 * 每百克营养值、token 消耗全部打出来，方便对照照片判断"这像不像"。
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { loadEnv } from './env.mjs';
import { VISION_SYSTEM_PROMPT, buildVisionUserText } from '../src/core/ai/prompt.ts';

const env = loadEnv();
const KEY = env.DASHSCOPE_API_KEY;
const BASE = env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = env.VISION_MODEL || 'qwen3-vl-plus';

if (!KEY) {
  console.error('缺少 DASHSCOPE_API_KEY，请检查 app/.env.local');
  process.exit(1);
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function toDataUrl(path) {
  const buf = readFileSync(path);
  const mime = MIME[extname(path).toLowerCase()] || 'image/jpeg';
  return { url: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length, mime };
}

/** 从模型回复里抠出 JSON：兼容 ```json 围栏、前后多余文字 */
export function extractJson(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

const F = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d).replace(/\.0+$/, '') : '—');

async function runOne(path) {
  const img = toDataUrl(path);
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: img.url } },
          { type: 'text', text: buildVisionUserText({}) },
        ],
      },
    ],
    temperature: 0.1,
    // 百炼兼容模式支持 json_object；不支持时会被忽略而不是报错
    response_format: { type: 'json_object' },
  };

  console.log('\n' + '='.repeat(78));
  console.log(`图片: ${basename(path)}  (${(img.bytes / 1024).toFixed(0)} KB)`);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  const raw = await res.text();

  if (!res.ok) {
    console.log(`HTTP ${res.status} (${elapsed}ms)`);
    console.log(raw.slice(0, 900));
    return null;
  }

  const json = JSON.parse(raw);
  const content = json.choices?.[0]?.message?.content ?? '';
  const u = json.usage ?? {};
  console.log(`耗时 ${elapsed}ms | 输入 ${u.prompt_tokens ?? '?'} tok | 输出 ${u.completion_tokens ?? '?'} tok`);

  // qwen3-vl-plus 官方价：输入 ¥1/百万、输出 ¥10/百万
  if (u.prompt_tokens && u.completion_tokens) {
    const cost = (u.prompt_tokens * 1 + u.completion_tokens * 10) / 1_000_000;
    console.log(`本次成本 ≈ ¥${cost.toFixed(5)}`);
  }

  let data;
  try {
    data = extractJson(content);
  } catch (e) {
    console.log('!! JSON 解析失败:', e.message);
    console.log('原始输出:\n' + content.slice(0, 1200));
    return null;
  }

  console.log(`场景: ${data.scene ?? '—'}`);
  console.log(`参照物: ${data.reference?.detected ? (data.reference.objects ?? []).join('、') : '无'}`);
  console.log(`\n拆解结果 (${data.items?.length ?? 0} 项)`);
  console.log('─'.repeat(78));
  console.log('名称'.padEnd(12) + '所属菜'.padEnd(10) + '基准g'.padStart(6) + '区间'.padStart(12) + 'kcal'.padStart(7) + '蛋白'.padStart(6) + '脂肪'.padStart(6) + '碳水'.padStart(6) + '信度'.padStart(6));
  let totalKcal = 0;
  for (const it of data.items ?? []) {
    const p = it.per100g ?? {};
    const kcal = (p.kcal ?? 0) * (it.baseG ?? 0) / 100;
    totalKcal += kcal;
    console.log(
      String(it.name ?? '?').slice(0, 11).padEnd(12) +
      String(it.dish ?? '—').slice(0, 9).padEnd(10) +
      String(it.baseG ?? '?').padStart(6) +
      `[${(it.rangeG ?? []).join('~')}]`.padStart(12) +
      F(kcal, 0).padStart(7) +
      F((p.protein ?? 0) * (it.baseG ?? 0) / 100).padStart(6) +
      F((p.fat ?? 0) * (it.baseG ?? 0) / 100).padStart(6) +
      F((p.carbs ?? 0) * (it.baseG ?? 0) / 100).padStart(6) +
      F(it.confidence, 2).padStart(6),
    );
    if (it.note) console.log(`${' '.repeat(12)}↳ ${it.note}`);
  }
  console.log('─'.repeat(78));
  console.log(`合计 ${totalKcal.toFixed(0)} kcal | 整体置信度 ${F(data.confidence, 2)}`);
  for (const a of data.assumptions ?? []) console.log(`假设: ${a}`);

  return data;
}

const files = process.argv.slice(2).filter((p) => existsSync(resolve(p)));
if (files.length === 0) {
  console.error('用法: node tools/vision-probe.mjs <图片路径> ...');
  process.exit(1);
}
for (const f of files) {
  try {
    await runOne(resolve(f));
  } catch (e) {
    console.log(`\n!! ${basename(f)} 调用异常:`, e.message);
  }
}
