/** 最小连通性测试：只发一条文本，验证 Key / baseURL / 模型名是否可用。 */
import { loadEnv } from './env.mjs';

const env = loadEnv();
const key = env.DASHSCOPE_API_KEY;
const base = env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

console.log('key prefix :', key ? key.slice(0, 12) + '…' : '(missing)');
console.log('key length :', key ? key.length : 0);
console.log('base url   :', base);

async function probe(model) {
  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '只回复两个字：可用' }],
      max_tokens: 16,
    }),
  });
  const text = await res.text();
  console.log(`\n[${model}] status=${res.status} ${Date.now() - t0}ms`);
  console.log(text.slice(0, 600));
}

for (const m of ['qwen-plus', 'qwen3-vl-plus']) {
  try {
    await probe(m);
  } catch (e) {
    console.log(`[${m}] 请求异常:`, e.message);
  }
}
