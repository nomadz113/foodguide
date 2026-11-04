#!/usr/bin/env node
/**
 * 从 USDA FoodData Central（SR Legacy，CC0）生成「候选食物清单」。
 *
 * 用法：node tools/build-food-candidates.mjs <SR解压目录>
 * 输出：tools/out/food-candidates.md / .json
 *
 * 纪律（与 seed.ts 一致）：
 *  - 数值只从 CSV 抄，不做换算、不猜；缺项留 null，绝不填 0
 *  - 每条都带 fdc_id 与英文原名，便于逐条回溯
 *  - 微矿命中数 < 10 的条目标记 weak，默认不进库（会拉低 coverage）
 */

import fs from 'node:fs';
import path from 'node:path';

const SR_DIR = process.argv[2];
if (!SR_DIR) {
  console.error('用法：node tools/build-food-candidates.mjs <SR解压目录>');
  process.exit(1);
}

/**
 * 旧版 nutrient_nbr（SR28 编号）→ 项目字段。
 * FDC 的 nutrient_id 已换成 1003/1008 那套，靠 nutrient.csv 的 nutrient_nbr 做桥。
 */
const NBR_MAP = {
  208: 'kcal',
  203: 'protein',
  204: 'fat',
  205: 'carbs',
  291: 'fiber',
  269: 'sugar',
  307: 'sodium',
  306: 'potassium',
  301: 'calcium',
  303: 'iron',
  309: 'zinc',
  317: 'selenium',
  304: 'magnesium',
  320: 'va',
  401: 'vc',
  328: 'vd',
  323: 've',
  404: 'b1',
  405: 'b2',
  406: 'niacin',
};

const MICRO = [
  'calcium', 'iron', 'zinc', 'selenium', 'potassium', 'magnesium',
  'va', 'vc', 'vd', 've', 'b1', 'b2', 'niacin',
];

/**
 * 候选映射：中文名 + 分类 + 英文关键词（全部命中才算）
 * pick: 精确 fdc_id（关键词会命中多笔时用）
 * avoid: 命中即排除
 */
const MAPPING = [
  // ── 主食 / 杂豆 ──
  { cn: '藜麦', cat: '主食', kw: ['quinoa', 'uncooked'] },
  { cn: '荞麦面', cat: '主食', kw: ['buckwheat flour', 'whole-groat'] },
  { cn: '糯米', cat: '主食', kw: ['rice', 'glutinous'], pick: 168883 },
  { cn: '绿豆', cat: '主食', kw: ['mung beans', 'mature seeds', 'raw'] },
  { cn: '红豆', cat: '主食', kw: ['adzuki', 'raw'], avoid: ['canned'] },
  { cn: '黄豆', cat: '主食', kw: ['soybeans', 'mature seeds', 'raw'] },
  { cn: '白面包', cat: '主食', kw: ['bread', 'white', 'commercially prepared'], pick: 174924 },
  { cn: '玉米面', cat: '主食', kw: ['corn flour', 'whole-grain', 'yellow'] },
  { cn: '山药', cat: '主食', kw: ['yam', 'raw'], avoid: ['cooked', 'baked'], note: 'USDA 的 Yam 是美洲薯蓣（118kcal），中国山药约 57kcal，差异大' },

  // ── 蛋白：肉蛋奶 ──
  { cn: '羊肉', cat: '蛋白', kw: ['lamb', 'leg', 'raw'], avoid: ['australian', 'new zealand', 'cooked', 'lean only'] },
  { cn: '鸭肉', cat: '蛋白', kw: ['duck', 'domesticated', 'meat and skin', 'raw'], note: '带皮鸭 404kcal，中国成分表鸭肉约 240kcal，脂肪偏高' },
  { cn: '鹅肉', cat: '蛋白', kw: ['goose', 'domesticated', 'meat only', 'raw'] },
  { cn: '排骨', cat: '蛋白', kw: ['pork', 'spareribs', 'separable lean and fat', 'raw'] },
  { cn: '猪蹄', cat: '蛋白', kw: ['pork', 'feet', 'raw'] },
  { cn: '猪腰', cat: '蛋白', kw: ['pork', 'kidneys', 'raw'] },
  { cn: '牛肚', cat: '蛋白', kw: ['beef', 'tripe', 'raw'] },
  { cn: '鸡胗', cat: '蛋白', kw: ['chicken', 'gizzard', 'raw'] },
  { cn: '鸭蛋', cat: '蛋白', kw: ['egg', 'duck', 'whole', 'raw'] },
  { cn: '鹌鹑蛋', cat: '蛋白', kw: ['egg', 'quail', 'whole', 'raw'] },
  { cn: '奶酪', cat: '蛋白', kw: ['cheese', 'cheddar'], avoid: ['nonfat', 'fat free', 'low', 'reduced'] },
  { cn: '奶粉', cat: '蛋白', kw: ['milk', 'dry', 'whole'] },
  { cn: '淡奶油', cat: '蛋白', kw: ['cream', 'fluid', 'heavy whipping'] },
  { cn: '火腿', cat: '蛋白', kw: ['pork', 'cured', 'ham', 'whole', 'lean'], avoid: ['canned'] },

  // ── 蛋白：水产 ──
  { cn: '鳕鱼', cat: '蛋白', kw: ['fish', 'cod', 'atlantic', 'raw'] },
  { cn: '鲅鱼', cat: '蛋白', kw: ['fish', 'mackerel', 'atlantic', 'raw'] },
  { cn: '鲤鱼', cat: '蛋白', kw: ['fish', 'carp', 'raw'] },
  { cn: '金枪鱼', cat: '蛋白', kw: ['fish', 'tuna', 'yellowfin', 'fresh', 'raw'] },
  { cn: '鳗鱼', cat: '蛋白', kw: ['fish', 'eel', 'mixed species', 'raw'] },
  { cn: '螃蟹', cat: '蛋白', kw: ['crab', 'blue', 'raw'] },
  { cn: '蛤蜊', cat: '蛋白', kw: ['clam', 'mixed species', 'raw'] },
  { cn: '扇贝', cat: '蛋白', kw: ['scallop', 'mixed species', 'raw'] },
  { cn: '鱿鱼', cat: '蛋白', kw: ['squid', 'mixed species', 'raw'] },

  // ── 蔬菜 ──
  { cn: '茄子', cat: '蔬菜', kw: ['eggplant', 'raw'] },
  { cn: '青椒', cat: '蔬菜', kw: ['peppers', 'sweet', 'green', 'raw'] },
  { cn: '洋葱', cat: '蔬菜', kw: ['onions', 'raw'] },
  { cn: '芹菜', cat: '蔬菜', kw: ['celery', 'raw'] },
  { cn: '小白菜', cat: '蔬菜', kw: ['cabbage', 'chinese', 'pak-choi', 'raw'] },
  { cn: '芦笋', cat: '蔬菜', kw: ['asparagus', 'raw'] },
  { cn: '豆角', cat: '蔬菜', kw: ['beans', 'snap', 'green', 'raw'] },
  { cn: '冬瓜', cat: '蔬菜', kw: ['waxgourd', 'raw'] },
  { cn: '莲藕', cat: '蔬菜', kw: ['lotus root', 'raw'] },
  { cn: '白萝卜', cat: '蔬菜', kw: ['radishes', 'oriental', 'raw'] },
  { cn: '苦瓜', cat: '蔬菜', kw: ['balsam-pear', 'pods', 'raw'] },
  { cn: '丝瓜', cat: '蔬菜', kw: ['gourd', 'dishcloth', 'raw'] },
  { cn: '茼蒿', cat: '蔬菜', kw: ['chrysanthemum', 'garland', 'raw'] },
  { cn: '苋菜', cat: '蔬菜', kw: ['amaranth leaves', 'raw'] },
  { cn: '豌豆', cat: '蔬菜', kw: ['peas', 'green', 'raw'] },
  { cn: '毛豆', cat: '蔬菜', kw: ['soybeans', 'green', 'raw'] },
  { cn: '绿豆芽', cat: '蔬菜', kw: ['mung beans', 'sprouted', 'raw'] },
  { cn: '黄豆芽', cat: '蔬菜', kw: ['soybeans', 'sprouted', 'raw'] },
  { cn: '花菜', cat: '蔬菜', kw: ['cauliflower', 'raw'] },
  { cn: '圆白菜', cat: '蔬菜', kw: ['cabbage', 'raw'], avoid: ['chinese', 'red', 'savoy'] },
  { cn: '平菇', cat: '蔬菜', kw: ['mushrooms', 'oyster', 'raw'] },
  { cn: '金针菇', cat: '蔬菜', kw: ['mushrooms', 'enoki', 'raw'] },
  { cn: '海带', cat: '蔬菜', kw: ['kelp', 'raw'], note: 'USDA kelp 43kcal，中国鲜海带约 13kcal' },
  { cn: '大蒜', cat: '蔬菜', kw: ['garlic', 'raw'] },
  { cn: '生姜', cat: '蔬菜', kw: ['ginger root', 'raw'], note: 'USDA 80kcal，中国成分表姜约 46kcal' },

  // ── 水果 ──
  { cn: '西瓜', cat: '水果', kw: ['watermelon', 'raw'] },
  { cn: '梨', cat: '水果', kw: ['pears', 'raw'], avoid: ['canned', 'dried'] },
  { cn: '葡萄', cat: '水果', kw: ['grapes', 'red or green', 'raw'] },
  { cn: '草莓', cat: '水果', kw: ['strawberries', 'raw'] },
  { cn: '芒果', cat: '水果', kw: ['mangos', 'raw'] },
  { cn: '桃', cat: '水果', kw: ['peaches', 'raw'], avoid: ['canned', 'dried'] },
  { cn: '菠萝', cat: '水果', kw: ['pineapple', 'raw', 'all varieties'] },
  { cn: '柿子', cat: '水果', kw: ['persimmons', 'japanese', 'raw'] },
  { cn: '樱桃', cat: '水果', kw: ['cherries', 'sweet', 'raw'] },
  { cn: '荔枝', cat: '水果', kw: ['litchis', 'raw'] },
  { cn: '鲜枣', cat: '水果', kw: ['jujube', 'raw'] },
  { cn: '橘子', cat: '水果', kw: ['tangerines', 'mandarin', 'raw'] },
  { cn: '柚子', cat: '水果', kw: ['pummelo', 'raw'] },
  { cn: '柠檬', cat: '水果', kw: ['lemons', 'raw', 'without peel'] },
  { cn: '石榴', cat: '水果', kw: ['pomegranates', 'raw'] },
  { cn: '牛油果', cat: '水果', kw: ['avocados', 'raw'], pick: 171705 },
  { cn: '哈密瓜', cat: '水果', kw: ['melons', 'cantaloupe', 'raw'] },

  // ── 坚果种子 ──
  { cn: '腰果', cat: '坚果', kw: ['cashew nuts', 'raw'] },
  { cn: '开心果', cat: '坚果', kw: ['pistachio nuts', 'raw'] },
  { cn: '榛子', cat: '坚果', kw: ['hazelnuts or filberts'] },
  { cn: '南瓜子', cat: '坚果', kw: ['pumpkin and squash seed kernels', 'roasted'], avoid: ['salted'] },
  { cn: '葵花籽', cat: '坚果', kw: ['sunflower seed kernels', 'dried'] },
  { cn: '亚麻籽', cat: '坚果', kw: ['flaxseed'] },
  { cn: '奇亚籽', cat: '坚果', kw: ['chia seeds', 'dried'] },
  { cn: '板栗', cat: '坚果', kw: ['chestnuts', 'chinese', 'raw'] },

  // ── 油脂 / 调味 / 饮料 ──
  { cn: '橄榄油', cat: '油脂', kw: ['oil', 'olive', 'salad or cooking'] },
  { cn: '花生油', cat: '油脂', kw: ['oil', 'peanut', 'salad or cooking'] },
  { cn: '芝麻油', cat: '油脂', kw: ['oil', 'sesame', 'salad or cooking'] },
  { cn: '黄油', cat: '油脂', kw: ['butter', 'without salt'] },
  { cn: '醋', cat: '调味', kw: ['vinegar', 'distilled'] },
  { cn: '蚝油', cat: '调味', kw: ['sauce', 'oyster', 'ready-to-serve'] },
  { cn: '芝麻酱', cat: '调味', kw: ['sesame butter', 'tahini'] },
  { cn: '番茄酱', cat: '调味', kw: ['catsup'] },
  { cn: '蜂蜜', cat: '调味', kw: ['honey'] },
  { cn: '绿茶', cat: '饮料', kw: ['tea', 'green', 'brewed'] },
];

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',').map((s) => s.replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [];
    const out = {};
    cells.forEach((c, i) => {
      if (i >= head.length) return;
      out[head[i]] = c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"');
    });
    return out;
  });
}

const foods = readCsv(path.join(SR_DIR, 'food.csv')).map((r) => ({
  id: r.fdc_id,
  desc: r.description || '',
}));

const nutById = new Map();

/** nutrient_id → 项目字段（经 nutrient.csv 的 nutrient_nbr 换算） */
const idToKey = new Map();
for (const r of readCsv(path.join(SR_DIR, 'nutrient.csv'))) {
  const key = NBR_MAP[Number(r.nutrient_nbr)];
  if (key && !idToKey.has(r.id)) idToKey.set(r.id, key);
}

for (const r of readCsv(path.join(SR_DIR, 'food_nutrient.csv'))) {
  const key = idToKey.get(r.nutrient_id);
  if (!key) continue;
  const amt = Number(r.amount);
  if (!Number.isFinite(amt)) continue;
  let m = nutById.get(r.fdc_id);
  if (!m) nutById.set(r.fdc_id, (m = {}));
  if (m[key] === undefined) m[key] = amt;
}

function pickOne(entry) {
  const kws = entry.kw.map((k) => k.toLowerCase());
  const avoid = (entry.avoid || []).map((k) => k.toLowerCase());
  let hits = foods.filter((f) => {
    const d = f.desc.toLowerCase();
    return kws.every((k) => d.includes(k)) && !avoid.some((k) => d.includes(k));
  });
  if (!hits.length) return null;
  if (entry.pick) {
    const exact = hits.find((h) => h.id === String(entry.pick));
    if (exact) return exact;
  }
  hits.sort((a, b) => a.desc.length - b.desc.length);
  return hits[0];
}

const rows = MAPPING.map((e) => {
  const food = pickOne(e);
  if (!food) return { ...e, hit: false };
  const n = nutById.get(food.id) || {};
  const microHits = MICRO.filter((k) => typeof n[k] === 'number').length;
  return { ...e, hit: true, fdcId: food.id, usda: food.desc, n, microHits };
});

const ok = rows.filter((r) => r.hit);
const weak = ok.filter((r) => r.microHits < 10);
const missing = rows.filter((r) => !r.hit);

const fmt = (v, d = 1) => (typeof v === 'number' ? (Math.round(v * 10 ** d) / 10 ** d).toString() : '—');

let md = `# 候选食物清单（来源：USDA FDC SR Legacy，CC0）\n\n`;
md += `共 ${rows.length} 个候选中名，命中 ${ok.length}，其中微矿≥10 项 ${ok.length - weak.length} 条。\n\n`;
md += `| # | 中文名 | 分类 | kcal | 蛋白 | 脂 | 碳水 | 纤维 | 糖 | 钠 | 钾 | 钙 | 铁 | 锌 | 硒 | 镁 | VA | VC | VD | VE | B1 | B2 | 烟酸 | 微矿 | USDA 原名 / fdc_id |\n`;
md += `|---|--------|------|------|------|----|------|------|----|----|----|----|----|----|----|----|----|----|----|----|----|----|------|------|------|\n`;
ok.forEach((r, i) => {
  const n = r.n;
  md += `| ${i + 1} | ${r.cn} | ${r.cat} | ${fmt(n.kcal, 0)} | ${fmt(n.protein)} | ${fmt(n.fat)} | ${fmt(n.carbs)} | ${fmt(n.fiber)} | ${fmt(n.sugar)} | ${fmt(n.sodium, 0)} | ${fmt(n.potassium, 0)} | ${fmt(n.calcium, 0)} | ${fmt(n.iron)} | ${fmt(n.zinc)} | ${fmt(n.selenium)} | ${fmt(n.magnesium, 0)} | ${fmt(n.va, 0)} | ${fmt(n.vc)} | ${fmt(n.vd)} | ${fmt(n.ve)} | ${fmt(n.b1)} | ${fmt(n.b2)} | ${fmt(n.niacin)} | ${r.microHits} | ${r.usda} / ${r.fdcId} |\n`;
});
if (missing.length) {
  md += `\n## 未命中（SR Legacy 没有对应条目，需另找来源）\n\n`;
  md += missing.map((r) => `- ${r.cn}（${r.cat}）：关键词 ${r.kw.join(' + ')}`).join('\n');
  md += '\n';
}

const outDir = path.join(process.cwd(), 'tools', 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'food-candidates.md'), md);
fs.writeFileSync(
  path.join(outDir, 'food-candidates.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), source: 'USDA FDC SR Legacy (2018-04)', rows }, null, 1),
);

console.log(`命中 ${ok.length}/${rows.length}，微矿不足 10 项的 ${weak.length} 条`);
for (const w of weak) console.log(`  weak: ${w.cn} (${w.microHits}) — ${w.usda}`);
if (missing.length) console.log('未命中：' + missing.map((m) => m.cn).join('、'));
console.log('输出：tools/out/food-candidates.md');
