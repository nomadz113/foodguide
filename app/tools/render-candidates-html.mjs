#!/usr/bin/env node
/**
 * 把 tools/out/food-candidates.json 渲染成可勾选的审阅页（单文件、离线可用）。
 * 用法：node tools/render-candidates-html.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'tools', 'out');
const data = JSON.parse(fs.readFileSync(path.join(dir, 'food-candidates.json'), 'utf8'));
const rows = data.rows;

const COLS = [
  ['kcal', 'kcal', 0],
  ['protein', '蛋白', 1],
  ['fat', '脂', 1],
  ['carbs', '碳水', 1],
  ['fiber', '纤维', 1],
  ['sodium', '钠', 0],
  ['calcium', '钙', 0],
  ['iron', '铁', 1],
  ['zinc', '锌', 1],
  ['selenium', '硒', 1],
  ['va', 'VA', 0],
  ['vc', 'VC', 1],
  ['vd', 'VD', 1],
  ['ve', 'VE', 1],
  ['b1', 'B1', 2],
  ['b2', 'B2', 2],
  ['niacin', '烟酸', 1],
];

const fmt = (v, d) => (typeof v === 'number' ? (Math.round(v * 10 ** d) / 10 ** d).toString() : '—');

const cats = [...new Set(rows.map((r) => r.cat))];

const body = rows
  .map((r, i) => {
    const cells = COLS.map(([k, , d]) => `<td class="num">${fmt(r.n[k], d)}</td>`).join('');
    const warn = r.note ? `<div class="warn">⚠ ${r.note}</div>` : '';
    return `<tr data-cat="${r.cat}" data-name="${r.cn}">
<td class="sel"><input type="checkbox" aria-label="选择 ${r.cn}"></td>
<td class="idx">${i + 1}</td>
<td class="name">${r.cn}</td>
<td class="cat"><span class="pill">${r.cat}</span></td>
${cells}
<td class="num hits${r.microHits < 10 ? ' low' : ''}">${r.microHits}</td>
<td class="src">${r.usda}<span class="fdc">${r.fdcId}</span>${warn}</td>
</tr>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>候选食物清单 · USDA FDC SR Legacy</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--line:#e3e6ea;--fg:#1b1f24;--dim:#6b7280;--accent:#2563eb;--warn:#b45309;--warnbg:#fef3c7}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:12px 20px}
h1{margin:0 0 4px;font-size:16px;font-weight:650}
.sub{color:var(--dim);font-size:12.5px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 12px;font-size:12.5px;cursor:pointer;color:var(--fg)}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
input[type=search]{border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:13px;min-width:180px;outline:none}
input[type=search]:focus{border-color:var(--accent)}
button{font:inherit;border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 12px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.count{margin-left:auto;color:var(--dim);font-size:12.5px;white-space:nowrap}
.wrap{padding:14px 20px 60px}
table{border-collapse:separate;border-spacing:0;width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:12.5px}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}
thead th{position:sticky;top:86px;background:#fbfcfd;font-weight:600;font-size:12px;color:#374151;cursor:pointer;user-select:none}
thead th:hover{color:var(--accent)}
tbody tr:hover{background:#f9fafb}
tbody tr.checked{background:#eff6ff}
.num{text-align:right;font-variant-numeric:tabular-nums}
.sel{width:34px}
.idx{color:var(--dim);text-align:right;width:38px}
.name{font-weight:600}
.pill{background:#f1f3f5;color:#495057;border-radius:6px;padding:1px 7px;font-size:11.5px}
.hits{font-weight:600}
.hits.low{color:var(--warn)}
.src{color:var(--dim);font-size:11.5px;max-width:420px;white-space:normal}
.fdc{display:inline-block;margin-left:6px;color:#9ca3af}
.warn{margin-top:2px;color:var(--warn);background:var(--warnbg);border-radius:5px;padding:2px 6px;font-size:11px;display:inline-block}
.hidden{display:none}
</style></head><body>
<header>
  <h1>候选食物清单 · 92 条</h1>
  <div class="sub">来源：USDA FoodData Central — SR Legacy（2018-04，公共领域 CC0），每 100g 可食部。数值未经改写，缺项显示「—」。</div>
  <div class="bar">
    <button class="chip on" data-cat="*">全部</button>
    ${cats.map((c) => `<button class="chip" data-cat="${c}">${c}</button>`).join('')}
    <input type="search" id="q" placeholder="搜中文名 / 英文名">
    <button id="all">全选可见</button>
    <button id="none">清空</button>
    <button class="primary" id="copy">复制选中名单</button>
    <span class="count" id="cnt">已选 0 条</span>
  </div>
</header>
<div class="wrap">
<table id="t">
<thead><tr>
<th class="sel"></th><th>#</th><th>中文名</th><th>分类</th>
${COLS.map(([k, label]) => `<th class="num">${label}</th>`).join('')}
<th class="num">微矿</th><th>USDA 原名 / id</th>
</tr></thead>
<tbody>
${body}
</tbody></table>
</div>
<script>
const t = document.getElementById('t');
const cnt = document.getElementById('cnt');
const q = document.getElementById('q');
let cat = '*';

function visibleRows() {
  return [...t.tBodies[0].rows].filter((r) => !r.classList.contains('hidden'));
}
function refreshCount() {
  const n = [...t.tBodies[0].rows].filter((r) => r.classList.contains('checked')).length;
  cnt.textContent = '已选 ' + n + ' 条 · 入库后 ' + (80 + n) + ' 条';
}
function applyFilter() {
  const kw = q.value.trim().toLowerCase();
  for (const r of t.tBodies[0].rows) {
    const okCat = cat === '*' || r.dataset.cat === cat;
    const okKw = !kw || r.textContent.toLowerCase().includes(kw);
    r.classList.toggle('hidden', !(okCat && okKw));
  }
}
document.querySelectorAll('.chip').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    cat = b.dataset.cat;
    applyFilter();
  };
});
q.oninput = applyFilter;
t.tBodies[0].addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  e.target.closest('tr').classList.toggle('checked', e.target.checked);
  refreshCount();
});
document.getElementById('all').onclick = () => {
  for (const r of visibleRows()) {
    r.querySelector('input').checked = true;
    r.classList.add('checked');
  }
  refreshCount();
};
document.getElementById('none').onclick = () => {
  for (const r of t.tBodies[0].rows) {
    r.querySelector('input').checked = false;
    r.classList.remove('checked');
  }
  refreshCount();
};
document.getElementById('copy').onclick = async () => {
  const picked = [...t.tBodies[0].rows]
    .filter((r) => r.classList.contains('checked'))
    .map((r) => r.cells[2].textContent + '(' + r.dataset.cat + ')');
  const text = picked.length ? picked.join('、') : '（未选）';
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById('copy').textContent = '已复制 ' + picked.length + ' 条';
    setTimeout(() => (document.getElementById('copy').textContent = '复制选中名单'), 1600);
  } catch (err) {
    alert(text);
  }
};
let sortDir = {};
t.tHead.addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th || th.classList.contains('sel')) return;
  const i = th.cellIndex;
  sortDir[i] = !sortDir[i];
  const dir = sortDir[i] ? 1 : -1;
  const rows = [...t.tBodies[0].rows];
  rows.sort((a, b) => {
    const A = a.cells[i].textContent.trim();
    const B = b.cells[i].textContent.trim();
    const na = parseFloat(A);
    const nb = parseFloat(B);
    if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
    return A.localeCompare(B, 'zh') * dir;
  });
  rows.forEach((r) => t.tBodies[0].appendChild(r));
});
refreshCount();
</script></body></html>`;

const out = path.join(dir, 'food-candidates.html');
fs.writeFileSync(out, html);
console.log('输出：' + out);
