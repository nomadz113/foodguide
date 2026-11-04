/**
 * Keep 体脂秤截图识别链路的真实端到端验证。
 *
 * 为什么单独做这个脚本、而不是只写单测：
 * 单测能证明 parseKeepDraft 把 "--" 变成 null，但证明不了**模型能不能在一张
 * 真实的 Keep 截图里把体脂率和水分率分开**。后者才是这条链路存不存在的前提。
 *
 * 两条刻意的设计：
 *
 * 1. **屏幕自己画。** 只有自己知道图上印了什么，才能断言模型有没有编造。
 *    每个用例都藏一个诱饵（历史列表的旧值、"--"、7 天平均、lb 单位），
 *    这些正是线上会安静出错的地方。
 * 2. **图片按真实链路的参数压缩。** 视口 390 宽 × deviceScaleFactor 1.6 = 624×1280，
 *    输出 JPEG quality 0.9 —— 与 compressForVision(blob, 1280, 0.9) 等价。
 *    若直接拿 PNG 原图去问，测出来的是"理想输入"，上线后发现小字糊掉已经晚了。
 *
 * 用法：node tools/keep-photo-probe.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { loadEnv } from './env.mjs';

// core 里的模块互相 import 不带扩展名（TS 习惯），Node 原生 ESM 解析不了，
// 借 Vite 的 SSR 通道加载 —— 解析规则与构建产物一致，不会"脚本跑通、打包失败"。
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule(p);
const { KEEP_SCALE_SYSTEM_PROMPT, buildKeepUserText, parseKeepDraft, parseKeepTime, parseKeepTimeParts } =
  await load('/src/core/ai/keepPrompt.ts');
const { checkScaleReading } = await load('/src/core/scale/guard.ts');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const env = loadEnv();
const KEY = env.DASHSCOPE_API_KEY;
const BASE = env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = env.VISION_MODEL || 'qwen3-vl-plus';

/** 真实链路的压缩参数：视口宽 390，放大到长边 1280 */
const VIEW_W = 390;
const VIEW_H = 800;
const SCALE = 1280 / VIEW_H;

const CASES = [
  {
    name: 'detail',
    file: 'keep-scale-detail.jpg',
    // clock：页面上印了时分，模型必须原样抄回来。
    // 抄丢了就退化成 00:00（用户报的就是这个），抄错了就是把记录挪到别的时刻。
    expect: { weight: 72.4, bodyFatPct: 22.8, unit: 'kg', date: '2026-10-24', clock: '07:35' },
  },
  {
    name: 'list',
    file: 'keep-scale-list.jpg',
    // 列表最新一条是今天的 72.4；旧值 72.9/73.1/73.4/73.8 都是诱饵
    expect: { weight: 72.4, date: 'today', clock: '08:12' },
  },
  {
    name: 'nofat',
    file: 'keep-scale-nofat.jpg',
    // 体脂率显示 "--"：必须 null，绝不能是 0
    expect: { weight: 72.4, bodyFatPct: null, clock: '07:35' },
  },
  {
    name: 'avg',
    file: 'keep-scale-avg.jpg',
    // 7 天平均：不能当成一次新测量。
    // 这张图的时间栏只印了日期（没有时分）—— 和 Keep 列表页一样。
    // noClock：模型不许自己补一个 00:00 或编个时分出来；
    // 时分由 pickScaleTime 从截图文件时间借，这里只保证它没撒谎。
    expect: { aggregate: true, date: '2026-10-24', noClock: true },
  },
  {
    name: 'lb',
    file: 'keep-scale-lb.jpg',
    expect: { weight: 158.9, unit: 'lb', bodyFatPct: 24.1, clock: '21:05' },
  },
];

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${VIEW_W}px; min-height: ${VIEW_H}px; background: #fff;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    color: #111; -webkit-font-smoothing: antialiased;
  }
  .bar { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 10px; }
  .bar .t { font-size: 17px; font-weight: 600; }
  .bar .ico { font-size: 17px; color: #333; }
  .hero { text-align: center; padding: 26px 20px 10px; }
  .hero .when { font-size: 12.5px; color: #8a8f99; margin-bottom: 14px; }
  .hero .num { font-size: 68px; font-weight: 700; line-height: 1; letter-spacing: -1px; }
  .hero .unit { font-size: 16px; color: #8a8f99; margin-left: 3px; font-weight: 500; }
  .hero .cap { font-size: 12.5px; color: #8a8f99; margin-top: 10px; }
  .cards { display: flex; gap: 10px; padding: 18px 16px 0; }
  .card { flex: 1; background: #f5f6f7; border-radius: 14px; padding: 13px 14px; }
  .card .k { font-size: 12px; color: #8a8f99; }
  .card .v { font-size: 22px; font-weight: 600; margin-top: 5px; }
  .card .v small { font-size: 12px; font-weight: 500; color: #8a8f99; margin-left: 2px; }
  .sec { padding: 24px 18px 0; }
  .sec .h { font-size: 13px; color: #8a8f99; margin-bottom: 8px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; padding: 13px 0; border-bottom: 1px solid #f0f1f3; }
  .row .l { font-size: 13.5px; color: #6b7280; }
  .row .r { font-size: 17px; font-weight: 600; }
  .row .r small { font-size: 12px; font-weight: 500; color: #8a8f99; margin-left: 2px; }
  .dev { text-align: center; font-size: 12px; color: #b0b5bd; padding: 22px 0 8px; }
`;

function shell(inner) {
  return `<!doctype html><meta charset="utf-8"><style>${css}</style>${inner}`;
}

/** 测量详情页 */
const htmlDetail = shell(`
  <div class="bar"><span class="ico">‹</span><span class="t">体重记录</span><span class="ico">⋯</span></div>
  <div class="hero">
    <div class="when">2026-10-24 07:35</div>
    <div class="num">72.4<span class="unit">kg</span></div>
    <div class="cap">较上次 -0.5 kg</div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">体脂率</div><div class="v">22.8<small>%</small></div></div>
    <div class="card"><div class="k">BMI</div><div class="v">24.1</div></div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">肌肉量</div><div class="v">52.9<small>kg</small></div></div>
    <div class="card"><div class="k">水分率</div><div class="v">55.6<small>%</small></div></div>
  </div>
  <div class="dev">Keep 体脂秤 S3</div>
`);

/** 历史列表页：最新在最上面，其余四条是诱饵 */
const history = [
  ['今天 08:12', '72.4', true],
  ['10月26日 07:50', '72.9', false],
  ['10月25日 07:42', '73.1', false],
  ['10月24日 07:35', '73.4', false],
  ['10月23日 08:01', '73.8', false],
];
const htmlList = shell(`
  <div class="bar"><span class="ico">‹</span><span class="t">体重记录</span><span class="ico">⋯</span></div>
  <div class="hero">
    <div class="when">今天 08:12</div>
    <div class="num">72.4<span class="unit">kg</span></div>
    <div class="cap">体脂率 22.8%</div>
  </div>
  <div class="sec">
    <div class="h">全部记录</div>
    ${history
      .map(
        ([when, kg]) => `<div class="row"><span class="l">${when}</span><span class="r">${kg}<small>kg</small></span></div>`,
      )
      .join('')}
  </div>
  <div class="dev">Keep 体脂秤 S3</div>
`);

/** 未测体脂率：显示破折号 */
const htmlNofat = shell(`
  <div class="bar"><span class="ico">‹</span><span class="t">体重记录</span><span class="ico">⋯</span></div>
  <div class="hero">
    <div class="when">2026-10-24 07:35</div>
    <div class="num">72.4<span class="unit">kg</span></div>
    <div class="cap">仅测量体重（赤脚站立可测体脂）</div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">体脂率</div><div class="v">--</div></div>
    <div class="card"><div class="k">BMI</div><div class="v">24.1</div></div>
  </div>
  <div class="dev">Keep 体脂秤 S3</div>
`);

/** 7 天平均：只有一个平均值，没有今日值 */
const htmlAvg = shell(`
  <div class="bar"><span class="ico">‹</span><span class="t">体重趋势</span><span class="ico">⋯</span></div>
  <div class="hero">
    <div class="when">2026-10-24</div>
    <div class="num">72.9<span class="unit">kg</span></div>
    <div class="cap">近 7 天平均</div>
    <div class="cap">较上周 -0.4 kg</div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">本周平均</div><div class="v">72.9<small>kg</small></div></div>
    <div class="card"><div class="k">上周平均</div><div class="v">73.3<small>kg</small></div></div>
  </div>
  <div class="dev">Keep 体脂秤 S3</div>
`);

/** 英制单位 */
const htmlLb = shell(`
  <div class="bar"><span class="ico">‹</span><span class="t">体重记录</span><span class="ico">⋯</span></div>
  <div class="hero">
    <div class="when">昨天 21:05</div>
    <div class="num">158.9<span class="unit">lb</span></div>
    <div class="cap">较上次 +1.2 lb</div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">体脂率</div><div class="v">24.1<small>%</small></div></div>
    <div class="card"><div class="k">BMI</div><div class="v">24.1</div></div>
  </div>
  <div class="dev">Keep 体脂秤 S3</div>
`);

const HTML = {
  detail: htmlDetail,
  list: htmlList,
  nofat: htmlNofat,
  avg: htmlAvg,
  lb: htmlLb,
};

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });

async function shoot(sc) {
  const path = resolve('testphotos', sc.file);
  const page = await browser.newPage();
  // deviceScaleFactor 取 1.6，让 390×800 的页面正好落在 624×1280 —— 与真实压缩后的尺寸一致
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: SCALE });
  await page.setContent(HTML[sc.name], { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 350));
  const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
  await page.close();
  writeFileSync(path, buf);
  return { path, buf };
}

async function ask(dataUrl) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: KEEP_SCALE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: buildKeepUserText() },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { content: j.choices?.[0]?.message?.content ?? '', usage: j.usage ?? {} };
}

const oks = [];
const fails = [];
const check = (cond, msg) => (cond ? oks.push(msg) : fails.push(msg));
/** 一位小数的浮点比较。模型可能给 72.40 或 72.4，不能 === */
const near = (a, b) => a != null && Math.abs(a - b) < 0.05;
/**
 * 本地时区的 YYYY-MM-DD。
 * **不要用 toISOString().slice(0,10)** —— 那是 UTC 日期，本地 07:35 会变成前一天 23:35，
 * 断言会红而代码其实是对的（第一次跑就踩了这个）。
 */
const localYmd = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

if (!KEY) {
  console.error('缺少 DASHSCOPE_API_KEY，检查 app/.env.local');
  await browser.close();
  await vite.close();
  process.exit(1);
}

const TODAY = new Date();

for (const sc of CASES) {
  const { path, buf } = await shoot(sc);
  console.log(`\n════ ${sc.name} ════ ${path}（${buf.length} 字节）`);

  const { content, usage } = await ask(`data:image/jpeg;base64,${buf.toString('base64')}`);
  console.log(`token in=${usage.prompt_tokens ?? '?'} out=${usage.completion_tokens ?? '?'}`);
  console.log('模型原话：' + content.replace(/\s+/g, ' ').slice(0, 460));

  let raw;
  try {
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    raw = fence ? JSON.parse(fence[1]) : JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  } catch {
    check(false, `[${sc.name}] 返回的不是合法 JSON`);
    continue;
  }

  const draft = parseKeepDraft(raw);
  console.log('解析后：', draft);

  const tag = `[${sc.name}]`;
  const exp = sc.expect;

  if (exp.weight != null) {
    check(near(draft.weight, exp.weight), `${tag} 体重 ${draft.weight}（屏幕 ${exp.weight}）`);
  }
  if (exp.unit) {
    check(draft.unit === exp.unit, `${tag} 单位 ${draft.unit}（屏幕 ${exp.unit}）`);
  }
  if ('bodyFatPct' in exp) {
    if (exp.bodyFatPct === null) {
      check(draft.bodyFatPct === null, `${tag} 体脂率应为 null，实得 ${draft.bodyFatPct}（0 就是错）`);
    } else {
      check(near(draft.bodyFatPct, exp.bodyFatPct), `${tag} 体脂率 ${draft.bodyFatPct}（屏幕 ${exp.bodyFatPct}）`);
    }
  }
  if (exp.aggregate) {
    // 可以答 null（说不准），**不能答 false** —— false 等于把平均值认证成一次新测量
    check(draft.isAggregate !== false, `${tag} 7天平均没被认证成单次测量（isAggregate=${draft.isAggregate}）`);
  }
  if (exp.date) {
    const t = parseKeepTime(draft.timeText, TODAY);
    if (exp.date === 'today') {
      check(t != null && localYmd(t) === localYmd(TODAY.getTime()), `${tag} 时间是今天（原文「${draft.timeText}」）`);
    } else {
      check(
        t != null && localYmd(t) === exp.date,
        `${tag} 屏显日期 ${exp.date}（原文「${draft.timeText}」→ ${t ? localYmd(t) : 'null'}）`,
      );
    }
  }

  // 时分：页面印了就抄准，没印就不许编。
  // 这是「日期对、时间是 0 点 0 分」那个 bug 的守卫 ——
  // 只要模型开始丢时分或补 00:00，这里立刻报出来。
  if (exp.clock || exp.noClock) {
    const p = parseKeepTimeParts(draft.timeText, TODAY);
    const d = p.ms == null ? null : new Date(p.ms);
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : 'null';
    if (exp.clock) {
      check(
        p.hasClock && hhmm === exp.clock,
        `${tag} 时分 ${hhmm}（页面 ${exp.clock}，原文「${draft.timeText}」）`,
      );
    } else {
      check(!p.hasClock, `${tag} 页面没印时分，模型不能自己补一个（原文「${draft.timeText}」）`);
    }
  }

  // 串一遍真流水线的校验层
  const outcome = checkScaleReading(draft);
  check(
    outcome.ok,
    `${tag} guard 放行：${outcome.ok ? `${outcome.reading.weightKg} kg / 体脂 ${outcome.reading.bodyFatPct}` : outcome.reason}`,
  );
}

await browser.close();
await vite.close();

console.log('\n=== 结果 ===');
for (const o of oks) console.log('  ✓', o);
for (const f of fails) console.log('  ✗', f);
console.log(fails.length === 0 ? '\nPASS' : `\nFAIL (${fails.length}/${oks.length + fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
