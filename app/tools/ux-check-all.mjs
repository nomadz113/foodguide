/**
 * 体验门禁总入口 —— 一条命令跑完所有可自动判的 UX/无障碍约束。
 *
 * 这些脚本各自独立（`node tools/ux-probe6.mjs` 也能单跑），但它们是一族：
 *   · 每个都按「设计不变量」写断言，失败 exit 1；
 *   · 每个都能在 320/360/390 三档复跑，不依赖真机；
 *   · 每个文件头都写明它验什么、判据从哪来。
 * 这个入口只做三件事：按固定顺序跑、汇总成一张表、任一失败则整体非 0。
 *
 * 用法：
 *   node tools/ux-check-all.mjs            # 全跑（约 2~4 分钟，每个脚本各起一次 Edge）
 *   node tools/ux-check-all.mjs --fast     # 只跑纯计算的（跳过起浏览器的），约 2 秒
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const FAST = process.argv.includes('--fast');

/** [脚本, 一行说明, 是否需浏览器] */
const GATES = [
  ['ux-contrast-premise.mjs', '条件对比度：每个"达标"的数依赖哪层底色', false],
  ['ux-probe6.mjs', 'SVG 标签墨迹：不许压进绘图区，两张图让出同一个间隙', true],
  ['ux-probe7.mjs', '::before 热区：达 44 且不重叠，间隙归属不变', true],
  ['ux-probe10.mjs', '骨架页头：与真实 .hdr 差 0，中性主体一屏不出滚动条', true],
  ['ux-probe11.mjs', '柱内数字三段判据：顶/底/隐藏，598 个组合无相交（验设计，非产品代码）', true],
];

const run = (script) =>
  new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [resolve(APP, 'tools', script)], { cwd: APP });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => {
      const fails = out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());
      res({ script, code, ms: Date.now() - t0, fails, out });
    });
  });

const picked = GATES.filter(([, , needBrowser]) => (FAST ? !needBrowser : true));
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
const width = Math.max(...picked.map(([s]) => s.length), 4);

console.log(`\n体验门禁 ${picked.length} 组${FAST ? '（--fast，只跑纯计算）' : ''}\n`);
console.log(pad('脚本', width + 2) + pad('结果', 8) + pad('耗时', 8) + '说明');
console.log('-'.repeat(width + 2 + 8 + 8 + 40));

const results = [];
for (const [script, desc] of picked) {
  const r = await run(script);
  results.push(r);
  const verdict = r.code === 0 ? '✓ 通过' : '✗ 失败';
  console.log(pad(script, width + 2) + pad(verdict, 8) + pad((r.ms / 1000).toFixed(1) + 's', 8) + desc);
  if (r.code !== 0) {
    if (r.fails.length) for (const f of r.fails.slice(0, 6)) console.log('    ' + f);
    else console.log('    ' + (r.out.trim().split('\n').slice(-3).join('\n    ')));
  }
}

const bad = results.filter((r) => r.code !== 0);
console.log('');
if (bad.length) {
  console.log(`${bad.length} / ${results.length} 组失败：${bad.map((b) => b.script).join(', ')}\n`);
  process.exit(1);
}
console.log(`全部 ${results.length} 组通过。`);
console.log(`
注意：这些门禁验的是**设计不变量**，不是"产品代码已经这么写了"。
  · probe11 自己注入 .cval.low / .cval.hide 的规则再量几何 —— 它证明判据成立，
    不证明 DietStats.tsx 里已经实现（落地状态请 grep：blocked / cval.low）。
  · 同理 probe10 验的是规格，骨架是否已改中性三块要看 Loading.tsx。
  · contrast-premise 是唯一的例外：它直接读 index.css 的 token，验的就是现状。\n`);
