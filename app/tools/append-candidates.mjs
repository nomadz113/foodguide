#!/usr/bin/env node
/**
 * 把候选清单（tools/out/food-candidates.json）展开成 seed.ts 的 ROWS 条目。
 *
 * 默认 dry-run：只打印统计与将要写入的片段预览，不改文件。
 *   node tools/append-candidates.mjs
 * 确认后写入（追加到 ROWS 末尾，不位移既有 id）：
 *   node tools/append-candidates.mjs --write
 *
 * 三条硬约束（与 seed.ts 文件头纪律一致）：
 * 1. 追加在末尾 —— id 由下标生成，往前插会让 MealItem.foodId 张冠李戴。
 * 2. 每条已知微量 ≥10 项 —— coverage.test.ts 的断言，少一项都会让那条食物对覆盖率无贡献。
 * 3. 别名长度 ≥2 —— 单字别名在 similarity() 里退化成 0.8 的包含判断，
 *    「鱼」会吃掉草鱼/鲫鱼/鱼丸，历史上就是这么把鲈鱼认成所有鱼的。
 *
 * 另有 CN_OVERRIDE：4 条 USDA 与中式口径差太多的条目改用中国食物成分表（第6版）数值。
 */

import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const ROOT = process.cwd();
const CAND = path.join(ROOT, 'tools', 'out', 'food-candidates.json');
const SEED = path.join(ROOT, 'src', 'core', 'food', 'seed.ts');
const MARK_BEGIN = '  // ─── 扩展库 v7（USDA SR Legacy 2018-04，CC0；4 条用中国食物成分表第6版） ───';
const MARK_END = '  // ─── 扩展库结束 ───';

/** 13 项微量，用于校验条目的数据密度 */
const MICRO = [
  'calcium', 'iron', 'zinc', 'selenium', 'potassium', 'magnesium',
  'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin',
];

/**
 * 中国食物成分表（第 6 版）数值覆盖 —— USDA 这几条与中式口径差 2~9 倍，不能直接用：
 * 山药 USDA 走美洲薯蓣 118kcal（中国山药 57），海带 43 vs 13，鸭肉带皮 404 vs 240，生姜 80 vs 46。
 */
const CN_OVERRIDE = {
  山药: {
    macro: [57, 1.9, 0.2, 12.4],
    n: {
      fiber: 0.8, sodium: 18.6,
      potassium: 213, calcium: 16, iron: 0.3, zinc: 0.27, selenium: 0.55, magnesium: 20,
      va: 3, vc: 5, vd: 0, ve: 0.24, b1: 0.05, b2: 0.02, niacin: 0.3,
    },
  },
  海带: {
    macro: [13, 1.2, 0.1, 2.1],
    n: {
      fiber: 0.5, sodium: 8.6,
      potassium: 246, calcium: 46, iron: 0.9, zinc: 0.16, selenium: 0.49, magnesium: 25,
      va: 0, vc: 0, vd: 0, ve: 0.85, b1: 0.02, b2: 0.15, niacin: 1.3,
    },
  },
  鸭肉: {
    macro: [240, 15.5, 19.7, 0.2],
    n: {
      sodium: 69,
      potassium: 191, calcium: 6, iron: 2.2, zinc: 1.33, selenium: 12.25, magnesium: 14,
      va: 52, vc: 0, ve: 0.27, b1: 0.08, b2: 0.22, niacin: 4.2,
    },
  },
  生姜: {
    macro: [46, 1.3, 0.6, 10.3],
    n: {
      fiber: 2.7, sodium: 14.9,
      potassium: 295, calcium: 27, iron: 1.4, zinc: 0.34, selenium: 0.56, magnesium: 44,
      va: 28, vc: 4, vd: 0, b1: 0.02, b2: 0.03, niacin: 0.6,
    },
  },
};

/**
 * 手工补的条目（候选清单里没有、但确实是日常高频，且数值有依据）。
 * 黑米/黑米粥：中国食物成分表黑米，粥按 1:7 折算 —— 库里「生重」和「成粥」必须分开，
 * 否则黑米粥会匹配到黑米，把 341kcal 的生米微量填进一碗粥。
 */
const EXTRA = [
  {
    cn: '黑米', cat: '主食',
    macro: [341, 9.4, 2.5, 72.2],
    n: {
      fiber: 3.9, sodium: 7.1,
      potassium: 256, calcium: 12, iron: 1.6, zinc: 3.8, selenium: 3.2, magnesium: 147,
      va: 0, vc: 0, vd: 0, b1: 0.33, b2: 0.13,
    },
    serving: [1, '份', 50],
    aliases: ['黑大米', '紫米'],
    usda: '中国食物成分表第6版',
  },
  {
    cn: '黑米粥', cat: '主食',
    macro: [43, 1.2, 0.3, 9],
    n: {
      fiber: 0.5, sodium: 1,
      potassium: 32, calcium: 1.5, iron: 0.2, zinc: 0.5, selenium: 0.4, magnesium: 18,
      va: 0, vc: 0, vd: 0, b1: 0.04, b2: 0.02,
    },
    serving: [1, '碗', 300],
    aliases: ['紫米粥', '黑米稀饭'],
    usda: '按黑米 1:7 折算（估算）',
  },
];

/** 中文同义写法。别名一律 ≥2 字，理由见文件头第 3 条 */
const ALIASES = {
  藜麦: ['藜麦米', '奎奴亚藜'],
  荞麦面: ['荞麦面条', '荞面', '苦荞面'],
  糯米: ['江米', '圆糯米', '长糯米'],
  绿豆: ['青小豆', '绿豆粒'],
  红豆: ['赤小豆', '红小豆'],
  黄豆: ['大豆', '黄大豆'],
  白面包: ['吐司', '白吐司', '土司', '切片面包'],
  玉米面: ['玉米粉', '棒子面', '苞米面'],
  山药: ['淮山', '怀山药', '铁棍山药', '薯蓣'],

  羊肉: ['羊肉片', '羊腿肉', '羔羊肉'],
  鸭肉: ['鸭腿肉', '鸭块', '烤鸭肉'],
  鹅肉: ['鹅肉块', '大鹅'],
  排骨: ['猪排骨', '小排', '肋排', '排骨块'],
  猪蹄: ['猪脚', '猪手', '猪蹄块'],
  猪腰: ['猪肾', '腰花', '猪腰子'],
  牛肚: ['牛百叶', '毛肚', '牛胃'],
  鸡胗: ['鸡肫', '鸡胃', '鸡胗子'],
  鸭蛋: ['鸭蛋仁', '青皮鸭蛋'],
  鹌鹑蛋: ['鹑蛋', '鹌鹑蛋仁'],
  奶酪: ['芝士', '起司', '干酪', '切达奶酪'],
  奶粉: ['全脂奶粉', '乳粉', '奶粉冲剂'],
  淡奶油: ['稀奶油', '鲜奶油', '动物奶油'],
  火腿: ['火腿片', '火腿肉', '金华火腿'],
  鳕鱼: ['鳕鱼片', '大西洋鳕鱼', '银鳕鱼'],
  鲅鱼: ['马鲛鱼', '燕鱼'],
  鲤鱼: ['鲤子', '河鲤'],
  金枪鱼: ['吞拿鱼', '鲔鱼', '金枪鱼块'],
  鳗鱼: ['白鳝', '鳗鲡', '河鳗'],
  螃蟹: ['河蟹', '大闸蟹', '梭子蟹', '蟹肉'],
  蛤蜊: ['花蛤', '文蛤', '蚬子', '蛤蜊肉'],
  扇贝: ['带子', '扇贝肉', '鲜贝'],
  鱿鱼: ['鱿鱼须', '枪乌贼', '鲜鱿'],

  茄子: ['紫茄子', '长茄子', '圆茄子'],
  青椒: ['柿子椒', '菜椒', '甜椒', '青柿子椒'],
  洋葱: ['圆葱', '葱头', '紫洋葱', '白洋葱'],
  芹菜: ['西芹', '旱芹', '芹菜段'],
  小白菜: ['青菜', '上海青', '小油菜', '油菜', '鸡毛菜'],
  芦笋: ['石刁柏', '芦笋尖'],
  豆角: ['豇豆', '四季豆', '长豆角', '菜豆'],
  冬瓜: ['白瓜', '冬瓜肉'],
  莲藕: ['藕片', '莲菜', '藕段'],
  白萝卜: ['萝卜', '莱菔', '白萝卜丝'],
  苦瓜: ['凉瓜', '苦瓜片'],
  丝瓜: ['水瓜', '天丝瓜', '丝瓜片'],
  茼蒿: ['蓬蒿', '皇帝菜', '蒿子杆'],
  苋菜: ['红苋菜', '青苋菜', '米苋'],
  豌豆: ['青豌豆', '豌豆粒', '鲜豌豆'],
  毛豆: ['毛豆仁', '枝豆', '青毛豆'],
  绿豆芽: ['银芽', '绿豆芽菜', '豆芽'],
  黄豆芽: ['大豆芽', '黄豆芽菜'],
  花菜: ['花椰菜', '菜花', '白花菜', '椰菜花'],
  圆白菜: ['卷心菜', '包菜', '洋白菜', '甘蓝', '绿甘蓝', '圆白菜丝'],
  平菇: ['侧耳', '平菇片', '鲜平菇'],
  金针菇: ['金菇', '朴菇', '金针蘑'],
  海带: ['海带丝', '海带结', '昆布', '鲜海带'],
  大蒜: ['蒜瓣', '蒜头', '蒜米', '大蒜瓣'],
  生姜: ['姜片', '老姜', '生姜片', '姜丝', '生姜末'],

  西瓜: ['西瓜瓤', '西瓜肉'],
  梨: ['雪梨', '鸭梨', '梨子'],
  葡萄: ['提子', '葡萄粒', '紫葡萄'],
  草莓: ['草莓果', '红颜草莓'],
  芒果: ['杧果', '芒果肉', '小台芒'],
  桃: ['桃子', '水蜜桃', '油桃'],
  菠萝: ['凤梨', '菠萝块'],
  柿子: ['脆柿', '柿子果'],
  樱桃: ['车厘子', '大樱桃'],
  荔枝: ['妃子笑', '荔枝肉'],
  鲜枣: ['冬枣', '鲜枣子'],
  橘子: ['桔子', '砂糖橘', '蜜橘'],
  柚子: ['蜜柚', '沙田柚', '文旦'],
  柠檬: ['柠檬果', '黄柠檬'],
  石榴: ['石榴籽', '软籽石榴'],
  牛油果: ['鳄梨', '油梨'],
  哈密瓜: ['甜瓜', '网纹瓜'],

  腰果: ['腰果仁', '生腰果'],
  开心果: ['阿月浑子', '开心果仁'],
  榛子: ['榛子仁', '平榛'],
  南瓜子: ['南瓜子仁', '白瓜子'],
  葵花籽: ['葵花子', '瓜子', '葵瓜子'],
  亚麻籽: ['胡麻籽', '亚麻子'],
  奇亚籽: ['奇亚子', '鼠尾草籽'],
  板栗: ['栗子', '毛栗', '板栗仁'],

  橄榄油: ['初榨橄榄油', '特级初榨橄榄油'],
  花生油: ['花生仁油', '生油'],
  芝麻油: ['香油', '麻油', '小磨香油'],
  黄油: ['动物黄油', '淡味黄油'],

  醋: ['米醋', '陈醋', '香醋'],
  蚝油: ['牡蛎油', '蚝汁'],
  芝麻酱: ['麻酱', '芝麻酱料'],
  番茄酱: ['茄汁', '番茄沙司'],
  蜂蜜: ['蜜糖', '土蜂蜜'],

  绿茶: ['茶水', '清茶', '绿茶水'],
};

/** 份量锚点（三档的 ×1.0）。按类别给默认值，个别另设 */
const SERVING_DEFAULT = {
  主食: [1, '份', 50],
  蛋白: [1, '份', 100],
  蔬菜: [1, '份', 150],
  水果: [1, '个', 150],
  坚果: [1, '把', 20],
  油脂: [1, '勺', 10],
  调味: [1, '勺', 10],
  饮料: [1, '杯', 250],
};
const SERVING = {
  白面包: [2, '片', 60],
  山药: [1, '份', 150],
  鸭蛋: [1, '个', 60],
  鹌鹑蛋: [1, '个', 10],
  奶酪: [1, '片', 20],
  奶粉: [2, '勺', 25],
  淡奶油: [2, '勺', 30],
  排骨: [1, '份', 120],
  猪蹄: [1, '份', 150],
  白萝卜: [1, '份', 200],
  冬瓜: [1, '份', 200],
  小白菜: [1, '份', 200],
  苋菜: [1, '份', 200],
  茼蒿: [1, '份', 200],
  圆白菜: [1, '份', 200],
  海带: [1, '份', 100],
  大蒜: [2, '瓣', 10],
  生姜: [2, '片', 6],
  西瓜: [1, '块', 300],
  哈密瓜: [1, '块', 200],
  柠檬: [1, '个', 100],
  牛油果: [1, '个', 150],
};

/**
 * 0 → null 的白名单。
 * 这几处的 0 不是「化学上不含」，而是 USDA 的检测空白或天然接近零：
 * 蔬菜没有钙、贝类没有维生素 E、内脏没有 B1，都是不可能的真零。
 */
const BLANK_ZERO = new Set([
  '金针菇:calcium',
  '青椒:selenium',
  '樱桃:selenium',
  '扇贝:ve',
  '白萝卜:ve',
  '平菇:ve',
  '牛肚:b1',
  '蜂蜜:vc',
  '绿茶:calcium',
  '绿茶:selenium',
]);

/** 数字格式化：去掉浮点尾巴，但保留 2 位有效小数 */
function fmt(v) {
  if (!Number.isFinite(v)) throw new Error('非法数值 ' + v);
  const r = Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return String(r);
}

/** 取有效微量：null 跳过；0 若在 BLANK_ZERO 里视为检测空白也跳过 */
function microOf(cn, n) {
  const out = {};
  for (const k of MICRO) {
    const v = n[k];
    if (v == null) continue;
    if (v === 0 && BLANK_ZERO.has(`${cn}:${k}`)) continue;
    out[k] = v;
  }
  return out;
}

/** 校验 13 项已知数 —— 与 coverage.test.ts 的「每条 ≥10 项」对齐 */
function checkMicro(cn, micro) {
  const n = MICRO.filter((k) => micro[k] != null).length;
  if (n < 10) throw new Error(`「${cn}」只有 ${n} 项微量，低于 10 项下限`);
  return n;
}

function renderEntry(cn, cat, macro, n, serving, aliases, origin) {
  const [kcal, protein, fat, carbs] = macro;
  const micro = microOf(cn, n);
  const hits = checkMicro(cn, micro);
  for (const a of aliases) {
    if (a.length < 2) throw new Error(`「${cn}」有单字别名「${a}」，会把同字食物全吃掉`);
  }

  const body = [];
  const head = [
    n.fiber != null ? `fiber: ${fmt(n.fiber)}` : null,
    n.sodium != null ? `sodium: ${fmt(n.sodium)}` : null,
  ].filter(Boolean).join(', ');
  if (head) body.push(`      ${head},`);
  const mins = ['potassium', 'calcium', 'iron', 'zinc', 'selenium', 'magnesium']
    .filter((k) => micro[k] != null).map((k) => `${k}: ${fmt(micro[k])}`).join(', ');
  if (mins) body.push(`      ${mins},`);
  const vits = ['va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin']
    .filter((k) => micro[k] != null).map((k) => `${k}: ${fmt(micro[k])}`).join(', ');
  if (vits) body.push(`      ${vits},`);

  const tail = [
    serving ? `[${serving[0]}, '${serving[1]}', ${serving[2]}]` : null,
    aliases.length ? `[${aliases.map((a) => `'${a}'`).join(', ')}]` : null,
  ].filter(Boolean).join(', ');

  const text = [
    `  ['${cn}', '${cat}', [${fmt(kcal)}, ${fmt(protein)}, ${fmt(fat)}, ${fmt(carbs)}],`,
    '    {',
    ...body,
    tail ? `    }, ${tail}],` : '    }],',
  ].join('\n');
  return { text, hits, origin };
}

// ── 主流程 ─────────────────────────────────────────────
const cand = JSON.parse(fs.readFileSync(CAND, 'utf8')).rows;
const seedSrc = fs.readFileSync(SEED, 'utf8');

const existingNames = new Set(
  [...seedSrc.matchAll(/^  \['([^']+)', '/gm)].map((m) => m[1]),
);
if (existingNames.size < 80) throw new Error('解析既有条目失败，只有 ' + existingNames.size + ' 条');

const entries = [];
const skipped = [];
for (const r of cand) {
  if (existingNames.has(r.cn)) {
    skipped.push(r.cn);
    continue;
  }
  const cnOverride = CN_OVERRIDE[r.cn];
  const macro = cnOverride ? cnOverride.macro : [r.n.kcal, r.n.protein, r.n.fat, r.n.carbs];
  const n = cnOverride ? cnOverride.n : r.n;
  const serving = SERVING[r.cn] ?? SERVING_DEFAULT[r.cat] ?? null;
  const aliases = ALIASES[r.cn] ?? [];
  if (!ALIASES[r.cn]) throw new Error(`「${r.cn}」缺别名条目（至少给一个同义写法）`);
  entries.push({
    cn: r.cn,
    cat: r.cat,
    aliasList: aliases,
    ...renderEntry(r.cn, r.cat, macro, n, serving, aliases, cnOverride ? 'CN' : r.usda),
  });
}
for (const e of EXTRA) {
  if (existingNames.has(e.cn)) { skipped.push(e.cn); continue; }
  entries.push({
    cn: e.cn,
    cat: e.cat,
    aliasList: e.aliases,
    ...renderEntry(e.cn, e.cat, e.macro, e.n, e.serving, e.aliases, e.usda),
  });
}

// 别名重复检查：同一个别名不能指向两条食物，也不能撞上已有条目的主名
const aliasOwner = new Map();
for (const n of existingNames) aliasOwner.set(n, '既有主名');
for (const e of entries) {
  for (const a of e.aliasList) {
    const owner = aliasOwner.get(a);
    if (owner) throw new Error(`别名「${a}」同时给了 ${owner} 和 ${e.cn}`);
    aliasOwner.set(a, e.cn);
  }
}

const block = [MARK_BEGIN, ...entries.map((e) => e.text), MARK_END].join('\n');

console.log(`候选 ${cand.length} 条 · 追加 ${entries.length} 条 · 跳过重复 ${skipped.length} 条${skipped.length ? '（' + skipped.join('、') + '）' : ''}`);
console.log(`替换为中国成分表的 ${Object.keys(CN_OVERRIDE).length} 条：${Object.keys(CN_OVERRIDE).join('、')}`);
const byCat = {};
for (const e of entries) byCat[e.cat] = (byCat[e.cat] ?? 0) + 1;
console.log('新增分类：' + Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('微量项数分布：' + JSON.stringify(entries.reduce((a, e) => ((a[e.hits] = (a[e.hits] ?? 0) + 1), a), {})));
console.log(`库内条目：${existingNames.size} → ${existingNames.size + entries.length}`);

if (!WRITE) {
  console.log('\n--- 预览前 2 条 ---\n' + entries.slice(0, 2).map((e) => e.text).join('\n'));
  console.log('\n（dry-run，未写入。加 --write 生效）');
} else {
  let src = seedSrc;
  // 幂等：已有旧块则整体替换
  const bi = src.indexOf(MARK_BEGIN);
  if (bi >= 0) {
    const ei = src.indexOf(MARK_END, bi);
    if (ei < 0) throw new Error('找到开始标记但没找到结束标记');
    src = src.slice(0, bi) + block + src.slice(ei + MARK_END.length);
  } else {
    const tail = '\n];\n\nfunction build()';
    if (!src.includes(tail)) throw new Error('找不到 ROWS 数组结尾');
    src = src.replace(tail, '\n\n' + block + '\n];\n\nfunction build()');
  }
  // 版本号 +1
  const m = src.match(/export const SEED_VERSION = (\d+);/);
  if (!m) throw new Error('找不到 SEED_VERSION');
  const nextVer = Number(m[1]) + 1;
  src = src.replace(m[0], `export const SEED_VERSION = ${nextVer};`);
  fs.writeFileSync(SEED, src);
  console.log(`\n已写入 seed.ts，SEED_VERSION ${m[1]} → ${nextVer}`);
}
