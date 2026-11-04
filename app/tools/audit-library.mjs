#!/usr/bin/env node
/**
 * 库体检：拿「AI 拆解后真实会吐出来的食材名」去打现有种子库，看命中率与微量补给。
 * 用法：node tools/audit-library.mjs [candidates.json]
 *
 * 为什么要用 vite.ssrLoadModule：core 里的 TS 是无扩展名互引，Node 直接跑不了。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const CAND_FILE = process.argv[2] || path.join(process.cwd(), 'tools', 'out', 'food-candidates.json');

/** 组 1：纯食材名——用户吃的东西拆到最后长这样，库里没有就等于微量全丢 */
const PLAIN = [
  '青椒', '茄子', '洋葱', '芹菜', '莲藕', '白萝卜', '豆角', '冬瓜', '苦瓜',
  '丝瓜', '苋菜', '茼蒿', '毛豆', '绿豆芽', '平菇', '海带', '豌豆', '花菜',
  '梨', '葡萄', '草莓', '芒果', '桃', '西瓜', '橘子', '柚子', '柿子',
  '腰果', '开心果', '榛子', '南瓜子', '亚麻籽', '板栗',
  '羊肉', '鸭肉', '排骨', '猪蹄', '猪腰', '牛肚', '鸡胗', '鸭蛋', '鹌鹑蛋',
  '奶酪', '奶粉', '鳕鱼', '鲅鱼', '鲤鱼', '螃蟹', '蛤蜊', '扇贝', '鱿鱼',
  '藜麦', '荞麦面', '绿豆', '红豆', '黄豆', '糯米', '山药', '玉米面',
  '橄榄油', '花生油', '黄油', '醋', '蚝油', '芝麻酱', '番茄酱', '蜂蜜', '绿茶',
].map((n) => ({ n, group: '纯食材' }));

/** 组 2：带修饰 / 口语 / 同义写法——考的是 aliases 与 normalize，不是条目数 */
const SPOKEN = [
  '西红柿', '西蓝花', '花椰菜', '卷心菜', '圆白菜', '上海青', '小白菜', '油麦菜',
  '菜心', '鸡大胸', '鸡脯肉', '猪里脊肉', '牛里脊', '土豆丝', '青椒丝',
  '大白菜', '圆生菜', '鸡蛋（炒）', '白米饭', '杂粮饭', '无糖豆浆', '整箱纯牛奶',
  '三文鱼刺身', '淡水鲈鱼', '鸡腿', '去皮鸡腿', '猪五花', '黑米粥', '燕麦粥',
].map((n) => ({ n, group: '口语/修饰' }));

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { SEED_FOODS } = await server.ssrLoadModule('/src/core/food/seed.ts');
  const { matchAndFill, MATCH_MIN } = await server.ssrLoadModule('/src/core/food/match.ts');
  const { MICRO_KEYS, NUTRIENT_LABELS, emptyFacts } = await server.ssrLoadModule(
    '/src/core/nutrition/types.ts',
  );

  /** 模拟 AI 的典型输出：只给 6 项宏量，13 项微矿全空 */
  const aiFacts = () => ({ ...emptyFacts(), kcal: 100, protein: 5, fat: 3, carbs: 10, fiber: 1, sodium: 300 });

  const cands = fs.existsSync(CAND_FILE)
    ? JSON.parse(fs.readFileSync(CAND_FILE, 'utf8')).rows.map((r) => ({
        id: 'cand_' + r.fdcId,
        name: r.cn,
        category: r.cat,
        aliases: [],
        per100g: { ...emptyFacts(), ...r.n },
      }))
    : [];

  const pools = {
    现状: SEED_FOODS,
    '现状+92': [...SEED_FOODS, ...cands],
  };

  for (const [label, pool] of Object.entries(pools)) {
    const all = [...PLAIN, ...SPOKEN];
    const rows = all.map(({ n, group }) => {
      const r = matchAndFill(n, aiFacts(), pool);
      return { n, group, hit: !!r.match, score: r.match?.score ?? 0, filled: r.filled.length, by: r.match?.matchedOn ?? null };
    });
    const hit = rows.filter((r) => r.hit);
    const plain = rows.filter((r) => r.group === '纯食材');
    const spoken = rows.filter((r) => r.group === '口语/修饰');
    console.log(`\n===== ${label}（库内 ${pool.length} 条，阈值 ${MATCH_MIN}）=====`);
    console.log(
      `整体命中 ${hit.length}/${rows.length}　纯食材 ${plain.filter((r) => r.hit).length}/${plain.length}　口语 ${spoken.filter((r) => r.hit).length}/${spoken.length}`,
    );
    const avgFill = hit.length ? hit.reduce((s, r) => s + r.filled, 0) / hit.length : 0;
    console.log(`命中项平均补到 ${avgFill.toFixed(1)} 项微量`);
    const miss = rows.filter((r) => !r.hit);
    if (miss.length) console.log('未命中：' + miss.map((m) => `${m.n}[${m.group[0]}]`).join('、'));

    // 逐项微矿：有多少条能提供该项
    const perKey = MICRO_KEYS.map((k) => {
      const n = pool.filter((f) => typeof f.per100g[k] === 'number').length;
      return `${NUTRIENT_LABELS[k]} ${Math.round((n / pool.length) * 100)}%`;
    });
    console.log('单项覆盖率：' + perKey.join('　'));
  }

  // 口语组的近似命中，单列出来看差在哪
  const near = SPOKEN.map(({ n }) => {
    const r = matchAndFill(n, aiFacts(), SEED_FOODS);
    return { n, hit: !!r.match, by: r.match?.matchedOn ?? null, score: r.match?.score ?? 0 };
  }).filter((x) => x.hit);
  if (near.length) {
    console.log('\n现状下口语名的已有命中（说明别名已经写对了）：');
    for (const x of near) console.log(`  ${x.n} → ${x.by} (${x.score.toFixed(2)})`);
  }
} finally {
  await server.close();
}
