/**
 * 血压拍照链路的真实端到端验证。
 *
 * 单测覆盖了 parse/guard/pickBpTime，check-bp 覆盖了录入 UI，
 * 唯独「提示词对着一张真的血压计照片说不说得出人话」谁也没证明过 ——
 * 而这恰恰是 P2 的存在理由（"能拍一张入一条"）。
 *
 * 做法：用浏览器渲染血压计屏幕并截图（比找真机器快，且能精确控制屏幕上印了
 * 什么，便于核对模型有没有编造），走真实百炼 API，再把返回值喂给
 * parseBpDraft → checkReading → pickBpTime，按真人流水线串起来。
 *
 * 跑两张图：一张带心律不齐标记（应当报 true，至少不能报"没有"），
 * 一张只有普通心形（绝不能报 true）—— 两个方向都得钉住。
 *
 * 用法：node tools/bp-photo-probe.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { loadEnv } from './env.mjs';

// core 里的模块互相 import 不带扩展名（TS 习惯），Node 的原生 ESM 解析不了，
// 所以借 Vite 的 SSR 通道加载它们 —— 解析规则和构建产物一致，不会出现
// "脚本里跑通了、打包后没跑通" 的假阳性。
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule(p);
const { BP_VISION_SYSTEM_PROMPT, buildBpUserText, parseBpDraft } = await load('/src/core/ai/bpPrompt.ts');
const { checkReading } = await load('/src/core/bp/guard.ts');
const { pickBpTime } = await load('/src/core/bp/time.ts');
const { draftFlags, pickBpSource } = await load('/src/core/bp/entry.ts');
const { dayKey } = await load('/src/core/date.ts');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const env = loadEnv();
const KEY = env.DASHSCOPE_API_KEY;
const BASE = env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = env.VISION_MODEL || 'qwen3-vl-plus';

/** 屏幕上印的东西。日期刻意写成三天前：这是"按拍摄时间归档"的主场景 */
const BASE_SCREEN = {
  systolic: 132,
  diastolic: 85,
  pulse: 74,
  unit: 'mmHg',
  dateLine: '2026-10-24  07:35',
  device: 'OMRON HEM-7136',
};

const CASES = [
  { name: 'ihb', file: 'bp-meter-ihb.png', irregular: true, expectIhb: true },
  { name: 'plain', file: 'bp-meter-plain.png', irregular: false, expectIhb: false },
];

/**
 * 心律不齐标记的两种画法。
 * 带波形：心形 + 内部折线 + 上方一道横线，和欧姆龙印的一样。
 * 普通心形：只是陪着 PULSE 出现的装饰，绝大多数机型都有 —— 模型必须能分辨。
 */
function iconOf(ihb) {
  return ihb
    ? '<svg width="26" height="24" viewBox="0 0 26 24"><path d="M13 22C6 17 2 13 2 9c0-3 2-5 5-5 2 0 4 1 6 4 2-3 4-4 6-4 3 0 5 2 5 5 0 3-2 5-4 6" fill="none" stroke="#8c2f2f" stroke-width="1.6"/><path d="M4 12h4l2-4 3 7 2-3h5" fill="none" stroke="#8c2f2f" stroke-width="1.6"/><rect x="3" y="1" width="20" height="2" rx="1" fill="#8c2f2f"/></svg>'
    : '<span class="heart">&#9825;</span>';
}

function htmlOf(sc) {
  const s = { ...BASE_SCREEN, ...sc };
  return `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; background:#1a1d1f; display:flex; align-items:center; justify-content:center; height:100vh; }
  .case { width:420px; background:#e9ecec; border-radius:26px; padding:26px 30px 34px; box-shadow:0 0 0 10px #d3d8d8 inset; }
  .lcd { background:#a9b7b0; border-radius:10px; padding:14px 18px 18px; font-family:"Courier New", monospace; color:#14191c; }
  .top { display:flex; justify-content:space-between; font-size:11px; letter-spacing:.06em; opacity:.75; }
  .num b { font-family:"Courier New", monospace; font-size:52px; font-weight:700; line-height:1; letter-spacing:.02em; }
  .lab { font-size:11px; letter-spacing:.12em; opacity:.7; }
  .row2 { display:flex; gap:22px; margin-top:12px; border-top:1px solid rgba(0,0,0,.18); padding-top:10px; align-items:flex-end; }
  .row2 div b { font-family:"Courier New", monospace; font-size:30px; }
  .row2 div span { font-size:11px; opacity:.7; margin-left:4px; }
  .heart { color:#8c2f2f; font-size:16px; }
  .foot { display:flex; justify-content:space-between; margin-top:14px; font-size:10.5px; opacity:.72; }
  .brand { text-align:center; margin-top:16px; font-size:12px; letter-spacing:.18em; opacity:.6; }
</style>
<div class="case">
  <div class="lcd">
    <div class="top"><span>${s.dateLine}</span><span>${s.unit}</span></div>
    <div class="lab">SYS  mmHg</div>
    <div class="num"><b>${s.systolic}</b></div>
    <div class="row2">
      <div><span class="lab">DIA</span> <b>${s.diastolic}</b><span>mmHg</span></div>
      <div><span class="lab">PULSE</span> <b>${s.pulse}</b><span>/min</span> ${iconOf(s.irregular)}</div>
    </div>
    <div class="foot"><span>${s.device}</span><span>USER 1</span></div>
  </div>
  <div class="brand">OMRON</div>
</div>`;
}

async function shoot(sc) {
  const path = resolve('testphotos', sc.file);
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 520, height: 420, deviceScaleFactor: 2 });
  await page.setContent(htmlOf(sc), { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 400));
  const buf = await page.screenshot({ type: 'png' });
  await browser.close();
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
        { role: 'system', content: BP_VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: buildBpUserText() },
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

if (!KEY) {
  console.error('缺少 DASHSCOPE_API_KEY，检查 app/.env.local');
  process.exit(1);
}

for (const sc of CASES) {
  const { path, buf } = await shoot(sc);
  console.log(`\n════ ${sc.name} ════ ${path}（${buf.length} 字节）`);

  const { content, usage } = await ask(`data:image/png;base64,${buf.toString('base64')}`);
  console.log(`token in=${usage.prompt_tokens ?? '?'} out=${usage.completion_tokens ?? '?'}`);
  console.log('模型原话：' + content.replace(/\s+/g, ' ').slice(0, 460));

  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? JSON.parse(fence[1]) : JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  const draft = parseBpDraft(raw);
  console.log('解析后：', draft);

  const tag = `[${sc.name}]`;
  check(draft.systolic === BASE_SCREEN.systolic, `${tag} 收缩压 ${draft.systolic}（屏幕 ${BASE_SCREEN.systolic}）`);
  check(draft.diastolic === BASE_SCREEN.diastolic, `${tag} 舒张压 ${draft.diastolic}（屏幕 ${BASE_SCREEN.diastolic}）`);
  check(draft.pulse === BASE_SCREEN.pulse, `${tag} 脉搏 ${draft.pulse}（屏幕 ${BASE_SCREEN.pulse}）`);
  check(
    draft.displayedAt != null && draft.displayedAt.includes('2026-10-24'),
    `${tag} 屏显时间 ${draft.displayedAt}（屏幕 ${BASE_SCREEN.dateLine}）`,
  );
  check(draft.isAverage !== true, `${tag} 没有凭空编出"平均值"`);

  if (sc.expectIhb) {
    // 认不出来可以容忍（用户能在确认卡上补标），**反着说不行** —— false 是替机器宣布心律整齐
    check(draft.irregular !== false, `${tag} 心律不齐没被否成 false（实得 ${draft.irregular}）`);
  } else {
    check(draft.irregular !== true, `${tag} 普通心形没有被误认成心律不齐（实得 ${draft.irregular}）`);
  }

  const outcome = checkReading(draft);
  check(outcome.ok, `${tag} guard 放行：${outcome.ok ? `${outcome.reading.systolic}/${outcome.reading.diastolic}` : outcome.reason}`);

  if (outcome.ok && sc.expectIhb) {
    const picked = pickBpTime(draft.displayedAt, { takenAt: Date.now(), source: 'mtime' });
    console.log(`归档决策：source=${picked.source} date=${dayKey(picked.measuredAt, 4)}`);
    check(picked.source === 'display', `${tag} 时刻来源 = ${picked.source}（屏显赢过文件时间）`);
    check(dayKey(picked.measuredAt, 4) === '2026-10-24', `${tag} 归档到三天前，不是今天`);
    check(draftFlags(draft).raw.length > 0, `${tag} rawSegments 留痕（不存照片时的唯一凭据）`);
    check(pickBpSource({ manual: false, recognised: true }) === 'photo', `${tag} 识别成功 → source=photo`);
  }
}

await vite.close();
console.log('\n=== 结果 ===');
for (const o of oks) console.log('  ✓', o);
for (const f of fails) console.log('  ✗', f);
console.log(fails.length === 0 ? '\nPASS' : `\nFAIL (${fails.length}/${oks.length + fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
