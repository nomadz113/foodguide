import { readFileSync, writeFileSync } from 'node:fs';
// 依赖装在托管 node 工作区，用绝对路径导入（ESM 不读 NODE_PATH）
const { marked } = await import('file:///C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules/marked/lib/marked.esm.js');

const SRC = 'C:/Users/Admin/Desktop/每日摄入指南/开发方案.md';
const OUT = 'C:/Users/Admin/Desktop/每日摄入指南/开发方案.html';

const md = readFileSync(SRC, 'utf8');
const body = marked.parse(md, { gfm: true, breaks: false });

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1116">
<title>好好吃饭 · 开发方案 v1.3</title>
<style>
  :root{
    --bg:#0e1116; --bg-soft:#151a21; --bg-card:#1a2029;
    --fg:#e6e9ef; --fg-dim:#9aa4b2; --fg-mute:#6b7684;
    --line:#252c37; --line-soft:#1e242d;
    --accent:#4ade80; --accent-2:#38bdf8; --warn:#fbbf24; --danger:#f87171;
    --code-bg:#11161c; --mark:#4ade80;
    --radius:10px;
  }
  @media (prefers-color-scheme: light){
    :root{
      --bg:#fbfcfd; --bg-soft:#f4f6f8; --bg-card:#fff;
      --fg:#171c24; --fg-dim:#4a5563; --fg-mute:#7c8798;
      --line:#e3e8ee; --line-soft:#edf1f5;
      --accent:#16a34a; --accent-2:#0284c7; --warn:#b45309; --danger:#dc2626;
      --code-bg:#f5f7fa; --mark:#16a34a;
    }
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0; background:var(--bg); color:var(--fg);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    font-size:16px; line-height:1.75; letter-spacing:.01em;
    -webkit-font-smoothing:antialiased;
    padding-bottom:calc(60px + env(safe-area-inset-bottom));
  }
  .wrap{display:flex; gap:0; max-width:1240px; margin:0 auto;}
  /* ── 侧栏目录 ── */
  aside{
    display:none; width:260px; flex:0 0 260px; position:sticky; top:0; height:100vh;
    overflow-y:auto; padding:32px 20px 32px 28px; border-right:1px solid var(--line-soft);
    scrollbar-width:thin;
  }
  aside .toc-title{font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--fg-mute); margin-bottom:14px;}
  aside a{
    display:block; color:var(--fg-dim); text-decoration:none; font-size:13.5px;
    padding:5px 10px; border-radius:6px; margin-bottom:1px; line-height:1.45;
    border-left:2px solid transparent; border-bottom:none;
  }
  aside a.lv3{padding-left:22px; font-size:12.5px; color:var(--fg-mute);}
  aside a:hover{background:var(--bg-soft); color:var(--fg);}
  aside a.active{color:var(--accent); border-left-color:var(--accent); background:var(--bg-soft); font-weight:600;}
  main{flex:1 1 auto; min-width:0; padding:28px 20px 48px;}
  @media(min-width:1000px){
    aside{display:block}
    main{padding:44px 56px 80px; max-width:900px;}
  }
  /* ── 顶部卡片 ── */
  .hero{
    background:linear-gradient(150deg, rgba(74,222,128,.10), rgba(56,189,248,.06) 55%, transparent);
    border:1px solid var(--line); border-radius:14px; padding:20px 22px; margin-bottom:34px;
  }
  .hero .tag{font-size:11px; letter-spacing:.14em; color:var(--accent); text-transform:uppercase; font-weight:700;}
  .hero h1{font-size:24px; margin:8px 0 6px; line-height:1.3; letter-spacing:-.01em;}
  .hero p{margin:0; color:var(--fg-dim); font-size:13.5px;}
  /* ── 排版 ── */
  h1,h2,h3,h4{line-height:1.35; letter-spacing:-.01em; font-weight:700; scroll-margin-top:20px;}
  main > h1{display:none}
  h2{
    font-size:20px; margin:44px 0 16px; padding-top:18px; border-top:1px solid var(--line-soft);
  }
  h2:first-of-type{border-top:none; padding-top:0; margin-top:8px;}
  h3{font-size:16px; margin:30px 0 12px; color:var(--fg);}
  h3::before{content:''; display:inline-block; width:3px; height:14px; background:var(--accent); border-radius:2px; margin-right:9px; vertical-align:-2px;}
  h4{font-size:14.5px; margin:22px 0 8px; color:var(--fg-dim);}
  p{margin:12px 0;}
  a{color:var(--accent-2); text-decoration:none; border-bottom:1px solid rgba(56,189,248,.3);}
  strong{color:var(--fg); font-weight:650;}
  em{color:var(--fg-dim); font-style:normal; background:var(--bg-soft); padding:1px 5px; border-radius:4px; font-size:.94em;}
  hr{border:none; border-top:1px solid var(--line-soft); margin:36px 0;}
  ul,ol{margin:12px 0; padding-left:22px;}
  li{margin:6px 0;}
  li::marker{color:var(--fg-mute);}
  /* ── 引用 ── */
  blockquote{
    margin:16px 0; padding:12px 16px; background:var(--bg-soft);
    border-left:3px solid var(--accent); border-radius:0 var(--radius) var(--radius) 0;
    color:var(--fg-dim);
  }
  blockquote p{margin:4px 0;}
  /* ── 表格 ── */
  .table-scroll{overflow-x:auto; margin:18px 0; -webkit-overflow-scrolling:touch; border:1px solid var(--line); border-radius:var(--radius);}
  table{border-collapse:collapse; width:100%; font-size:13.5px; min-width:min-content;}
  th,td{padding:9px 13px; text-align:left; border-bottom:1px solid var(--line-soft); vertical-align:top;}
  th{background:var(--bg-card); font-weight:650; color:var(--fg-dim); font-size:12.5px; white-space:nowrap; letter-spacing:.02em;}
  tr:last-child td{border-bottom:none;}
  tbody tr:hover{background:var(--bg-soft);}
  td code{font-size:12px;}
  /* ── 代码 ── */
  code{
    font-family:"SF Mono",ui-monospace,Menlo,Consolas,"Cascadia Code",monospace;
    font-size:13px; background:var(--code-bg); padding:2px 6px; border-radius:4px;
    color:var(--accent-2); border:1px solid var(--line-soft); word-break:break-word;
  }
  pre{
    background:var(--code-bg); border:1px solid var(--line); border-radius:var(--radius);
    padding:16px; overflow-x:auto; margin:18px 0; font-size:12.5px; line-height:1.65;
  }
  pre code{background:none; border:none; padding:0; color:var(--fg); font-size:12.5px;}
  /* ── 移动端目录 ── */
  #tocBtn{
    position:fixed; left:16px; bottom:calc(16px + env(safe-area-inset-bottom));
    padding:9px 16px; border-radius:20px; background:var(--bg-card); color:var(--fg-dim);
    border:1px solid var(--line); font-size:13px; cursor:pointer; z-index:30;
    box-shadow:0 4px 16px rgba(0,0,0,.25); font-family:inherit;
  }
  #drawer{
    position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:40;
    opacity:0; pointer-events:none; transition:opacity .2s;
    -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px);
  }
  #drawer.open{opacity:1; pointer-events:auto;}
  #drawer .panel{
    position:absolute; left:0; right:0; bottom:0; max-height:72vh; overflow-y:auto;
    background:var(--bg-soft); border-radius:18px 18px 0 0; padding:20px 18px calc(28px + env(safe-area-inset-bottom));
    transform:translateY(24px); transition:transform .22s ease;
    border-top:1px solid var(--line);
  }
  #drawer.open .panel{transform:none;}
  #drawer .panel .toc-title{font-size:11px;letter-spacing:.14em;color:var(--fg-mute);margin-bottom:12px;text-transform:uppercase;}
  #drawer a{
    display:block; color:var(--fg-dim); text-decoration:none; font-size:14px;
    padding:9px 8px; border-bottom:1px solid var(--line-soft);
  }
  #drawer a.lv3{padding-left:20px; font-size:13px; color:var(--fg-mute);}
  @media(min-width:1000px){ #tocBtn,#drawer{display:none} }
  /* ── 返回顶部 ── */
  #top{
    position:fixed; right:16px; bottom:calc(16px + env(safe-area-inset-bottom));
    width:42px; height:42px; border-radius:50%; background:var(--bg-card); color:var(--fg-dim);
    border:1px solid var(--line); display:flex; align-items:center; justify-content:center;
    cursor:pointer; opacity:0; pointer-events:none; transition:.25s; font-size:16px;
    box-shadow:0 4px 16px rgba(0,0,0,.25); z-index:30;
  }
  #top.show{opacity:1; pointer-events:auto;}
  @media print{
    aside,#top,#tocBtn,#drawer{display:none}
    body{background:#fff; color:#000}
    main{max-width:none; padding:0}
  }
</style>
</head>
<body>
<div class="wrap">
  <aside id="toc"><div class="toc-title">目录</div><nav id="tocNav"></nav></aside>
  <main>
    <div class="hero">
      <div class="tag">开发方案 · v1.3</div>
      <h1>好好吃饭</h1>
      <p>拍照识别一餐 · 个人档案与目标引擎 · AI 每日建议 · 周月季进度</p>
    </div>
${body}
  </main>
</div>
<button id="top" aria-label="返回顶部">↑</button>
<button id="tocBtn">目录</button>
<div id="drawer" role="dialog" aria-label="目录">
  <div class="panel">
    <div class="toc-title">目录</div>
    <nav id="tocSheetNav"></nav>
  </div>
</div>
<script>
(function(){
  // 表格包一层滚动容器
  document.querySelectorAll('main table').forEach(function(t){
    if(t.parentElement.classList.contains('table-scroll')) return;
    var d=document.createElement('div'); d.className='table-scroll';
    t.parentNode.insertBefore(d,t); d.appendChild(t);
  });

  // 生成目录（侧栏 + 移动抽屉）
  var heads=[].slice.call(document.querySelectorAll('main h2, main h3'));
  var containers=[document.getElementById('tocNav'), document.getElementById('tocSheetNav')];
  heads.forEach(function(h,i){
    if(!h.id) h.id='s'+i;
    var label=h.textContent.replace(/^[\\d.]+\\s*/,'').trim();
    containers.forEach(function(c){
      var a=document.createElement('a');
      a.href='#'+h.id; a.textContent=label;
      if(h.tagName==='H3') a.className='lv3';
      c.appendChild(a);
    });
  });

  // 侧栏滚动高亮
  var links=[].slice.call(document.querySelectorAll('#tocNav a'));
  var obs=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(!e.isIntersecting) return;
      links.forEach(function(l){ l.classList.toggle('active', l.getAttribute('href')==='#'+e.target.id); });
    });
  },{rootMargin:'-10% 0px -80% 0px'});
  heads.forEach(function(h){ obs.observe(h); });

  // 移动端抽屉
  var drawer=document.getElementById('drawer');
  document.getElementById('tocBtn').onclick=function(){ drawer.classList.add('open'); };
  drawer.onclick=function(e){
    if(e.target===drawer || e.target.tagName==='A') drawer.classList.remove('open');
  };
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') drawer.classList.remove('open'); });

  // 返回顶部
  var top=document.getElementById('top');
  window.addEventListener('scroll',function(){
    top.classList.toggle('show', window.scrollY>600);
  },{passive:true});
  top.onclick=function(){ window.scrollTo({top:0,behavior:'smooth'}); };
})();
</script>
</body>
</html>`;

writeFileSync(OUT, html, 'utf8');
console.log('OK ->', OUT, (html.length / 1024).toFixed(1) + 'KB');
