/**
 * 内置种子食物库（preset）。
 *
 * 定位：AI 识别失败的兜底，也是手动记账的快捷入口。
 * **更重要的定位：13 项维生素矿物质的唯一数据来源。**
 * 视觉模型只稳定输出 6 项（热量/蛋白/脂肪/碳水/纤维/钠），剩下 13 项微矿
 * 全靠这张表在 matchAndFill 里补 —— 所以这张表的微矿覆盖率直接决定
 * 今日页「微量充足度」能不能显示数字（coverage < 50% 就退化成「—」）。
 *
 * 数据来源：中国食物成分表（第 6 版）常见条目，熟食按「可食部」计；
 * 成分表缺项的用 USDA FoodData Central 补，取 100g 可食部的典型值。
 *
 * 纪律：
 * 1. 拿不准的微量营养素一律留 null，绝不填 0。
 *    宁可让 UI 显示「—」，也不要让用户以为「这份菜不含钙」。
 * 2. 填 0 的唯一场合是「这种食材化学上就不含」—— 白米饭没有维生素 C，
 *    精炼油没有矿物质。这类 0 是真实值，填上去不会撒谎。
 * 3. 新条目一律追加在数组末尾。id = preset_{序号}，往前插会让既有 id 位移，
 *    而 MealItem.foodId 和三档学习样本 (biasSamples) 都按 id 关联 —— 位移等于张冠李戴。
 */

import { facts, type NutritionFacts } from '../nutrition/types';

export interface SeedFood {
  id: string;
  name: string;
  category: string;
  aliases: string[];
  per100g: NutritionFacts;
  /** 中等份锚点（三档的 ×1.0） */
  serving: { quantity: number; unit: string; grams: number } | null;
}

type Row = [
  name: string,
  category: string,
  /** kcal, 蛋白, 脂肪, 碳水 */
  macro: [number, number, number, number],
  more?: Partial<NutritionFacts>,
  serving?: [number, string, number],
  aliases?: string[],
];

const ROWS: Row[] = [
  // ── 主食 ──
  ['米饭', '主食', [116, 2.6, 0.3, 25.9],
    {
      fiber: 0.3, sodium: 2.5,
      potassium: 30, calcium: 7, iron: 1.3, zinc: 0.6, selenium: 0.4, magnesium: 15,
      va: 0, vc: 0, vd: 0, ve: 0.03, b1: 0.02, b2: 0.03, niacin: 0.4,
    },
    [1, '碗', 150], ['白米饭', '大米饭', '蒸米饭']],
  ['糙米饭', '主食', [112, 2.7, 0.8, 24],
    {
      fiber: 0.6, sodium: 3,
      potassium: 86, calcium: 10, iron: 1.1, zinc: 1.7, selenium: 2.3, magnesium: 40,
      va: 0, vc: 0, vd: 0, ve: 0.6, b1: 0.11, b2: 0.05, niacin: 1.5,
    }, [1, '碗', 150], ['杂粮饭', '糙米']],
  ['白粥', '主食', [46, 1.1, 0.3, 9.9],
    {
      fiber: 0.1, sodium: 2,
      potassium: 13, calcium: 3, iron: 0.5, zinc: 0.2, selenium: 0.2, magnesium: 6,
      va: 0, vc: 0, vd: 0, ve: 0.01, b1: 0.01, b2: 0.01, niacin: 0.2,
    }, [1, '碗', 300], ['大米粥', '稀饭']],
  ['小米粥', '主食', [46, 1.4, 0.7, 8.4],
    {
      fiber: 0.2, sodium: 2,
      potassium: 70, calcium: 5, iron: 0.7, zinc: 0.3, selenium: 0.5, magnesium: 15,
      va: 7, vc: 0, vd: 0, ve: 0.1, b1: 0.03, b2: 0.02, niacin: 0.3,
    }, [1, '碗', 300]],
  ['馒头', '主食', [223, 7, 1.1, 47],
    {
      fiber: 1.3, sodium: 165,
      potassium: 138, calcium: 38, iron: 1.8, zinc: 0.7, selenium: 6, magnesium: 25,
      va: 0, vc: 0, vd: 0, ve: 0.3, b1: 0.05, b2: 0.04, niacin: 1.0,
    }, [1, '个', 100], ['白馒头', '馍馍']],
  ['全麦面包', '主食', [246, 8.5, 3.5, 45],
    {
      fiber: 6, sodium: 330,
      potassium: 250, calcium: 60, iron: 2.5, zinc: 1.2, selenium: 15, magnesium: 60,
      va: 0, vc: 0, vd: 0, ve: 0.9, b1: 0.3, b2: 0.15, niacin: 2.5,
    }, [2, '片', 70]],
  ['面条', '主食', [110, 3.9, 0.4, 22.8],
    {
      fiber: 0.5, sodium: 15,
      potassium: 40, calcium: 7, iron: 0.5, zinc: 0.4, selenium: 2, magnesium: 12,
      va: 0, vc: 0, vd: 0, ve: 0.1, b1: 0.05, b2: 0.02, niacin: 0.5,
    }, [1, '碗', 300], ['挂面', '汤面', '阳春面']],
  ['蛋炒饭', '主食', [163, 4.6, 5.6, 24],
    {
      fiber: 0.6, sodium: 380,
      potassium: 60, calcium: 15, iron: 0.8, zinc: 0.7, selenium: 5, magnesium: 12,
      va: 40, vc: 0, vd: 0.3, ve: 0.6, b1: 0.06, b2: 0.08, niacin: 0.8,
    }, [1, '盘', 250], ['炒饭']],
  ['饺子', '主食', [240, 9, 11, 26],
    {
      fiber: 1.2, sodium: 480,
      potassium: 130, calcium: 25, iron: 1.2, zinc: 1.3, selenium: 6, magnesium: 15,
      va: 15, vc: 3, vd: 0.1, ve: 0.8, b1: 0.15, b2: 0.1, niacin: 2,
    }, [10, '个', 200], ['水饺', '猪肉白菜饺']],
  ['燕麦片', '主食', [377, 15, 6.7, 61],
    {
      fiber: 5.3, sodium: 3.7,
      potassium: 214, calcium: 58, iron: 4.3, zinc: 2.2, selenium: 4.3, magnesium: 177,
      va: 0, vc: 0, vd: 0, ve: 3.1, b1: 0.3, b2: 0.13, niacin: 1.2,
    }, [1, '份', 40], ['麦片', '燕麦']],
  ['红薯', '主食', [106, 1.4, 0.2, 25.2],
    {
      fiber: 1.6, sodium: 28,
      potassium: 130, calcium: 23, iron: 0.5, zinc: 0.15, selenium: 0.5, magnesium: 17,
      va: 125, vc: 26, vd: 0, ve: 0.3, b1: 0.05, b2: 0.04, niacin: 0.6,
    }, [1, '个', 200], ['地瓜', '番薯']],
  ['玉米', '主食', [112, 4, 1.2, 22.8],
    {
      fiber: 2.9, sodium: 1.1,
      potassium: 238, calcium: 3, iron: 1.1, zinc: 0.9, selenium: 1.0, magnesium: 32,
      va: 5, vc: 16, vd: 0, ve: 0.5, b1: 0.16, b2: 0.1, niacin: 1.8,
    }, [1, '根', 200], ['甜玉米', '玉米棒']],
  ['土豆', '主食', [81, 2.6, 0.2, 17.8],
    {
      fiber: 1.1, sodium: 5,
      potassium: 342, calcium: 8, iron: 0.8, zinc: 0.37, selenium: 0.5, magnesium: 23,
      va: 1, vc: 27, vd: 0, ve: 0.34, b1: 0.08, b2: 0.04, niacin: 1.1,
    }, [1, '个', 150], ['马铃薯', '洋芋']],

  // ── 蛋白 ──
  ['鸡蛋', '蛋白', [144, 13.3, 8.8, 2.8],
    {
      fiber: 0, sodium: 131,
      potassium: 154, calcium: 56, iron: 2, zinc: 1.1, selenium: 14.3, magnesium: 10,
      va: 234, vc: 0, vd: 1.8, ve: 1.84, b1: 0.05, b2: 0.32, niacin: 0.2,
    }, [1, '个', 50], ['水煮蛋', '煮鸡蛋', '白煮蛋', '卤蛋', '茶叶蛋', '蒸蛋', '蛋羹', '蛋皮', '煎蛋']],
  ['鸡胸肉', '蛋白', [133, 19.4, 5, 2.5],
    {
      fiber: 0, sodium: 63,
      potassium: 338, calcium: 3, iron: 1.1, zinc: 0.9, selenium: 10.5, magnesium: 28,
      va: 16, vc: 0, vd: 0.1, ve: 0.22, b1: 0.07, b2: 0.13, niacin: 10.8,
    }, [1, '块', 120], ['鸡胸', '鸡脯肉', '鸡大胸', '鸡胸脯肉']],
  ['猪里脊', '蛋白', [155, 20.2, 7.9, 0.7],
    {
      fiber: 0, sodium: 43,
      potassium: 317, calcium: 6, iron: 1.5, zinc: 2.3, selenium: 9.5, magnesium: 28,
      va: 5, vc: 0, vd: 0.3, ve: 0.34, b1: 0.47, b2: 0.1, niacin: 5.1,
    }, [1, '份', 120], ['里脊肉', '瘦猪肉']],
  ['牛肉', '蛋白', [106, 20.2, 2.3, 1.2],
    {
      fiber: 0, sodium: 53.6,
      potassium: 284, calcium: 9, iron: 2.8, zinc: 3.7, selenium: 10.5, magnesium: 21,
      va: 7, vc: 0, vd: 0.1, ve: 0.65, b1: 0.03, b2: 0.11, niacin: 6.3,
    }, [1, '份', 120], ['瘦牛肉', '牛腱', '牛里脊', '牛后腿']],
  ['五花肉', '蛋白', [568, 7.7, 59, 0],
    {
      fiber: 0, sodium: 56,
      potassium: 188, calcium: 6, iron: 0.9, zinc: 1.2, selenium: 6, magnesium: 12,
      va: 10, vc: 0, vd: 0.3, ve: 0.3, b1: 0.3, b2: 0.1, niacin: 2.6,
    }, [1, '份', 80], ['猪五花', '五花肉片']],
  ['鲈鱼', '蛋白', [105, 18.6, 3.4, 0],
    {
      fiber: 0, sodium: 144,
      potassium: 205, calcium: 138, iron: 2, zinc: 2.8, selenium: 33, magnesium: 37,
      va: 19, vc: 0, vd: 4.6, ve: 0.8, b1: 0.03, b2: 0.17, niacin: 3.1,
    }, [1, '条', 250], ['清蒸鱼', '淡水鲈鱼', '加州鲈']],
  ['虾', '蛋白', [93, 18.6, 0.8, 2.8],
    {
      fiber: 0, sodium: 165,
      potassium: 215, calcium: 62, iron: 1.5, zinc: 2.4, selenium: 33.7, magnesium: 43,
      va: 15, vc: 0, vd: 0.1, ve: 1.4, b1: 0.02, b2: 0.05, niacin: 1.9,
    }, [10, '只', 100], ['对虾', '白灼虾', '基围虾']],
  ['豆腐', '蛋白', [116, 12.2, 4.8, 3],
    {
      fiber: 0.5, sodium: 7.3,
      potassium: 106, calcium: 138, iron: 1.9, zinc: 0.6, selenium: 1.5, magnesium: 63,
      va: 0, vc: 0, vd: 0, ve: 2.7, b1: 0.05, b2: 0.03, niacin: 0.4,
    }, [1, '块', 150], ['北豆腐', '老豆腐']],
  ['豆浆', '蛋白', [31, 3, 1.6, 1.2],
    {
      fiber: 0.5, sodium: 3,
      potassium: 48, calcium: 10, iron: 0.5, zinc: 0.25, selenium: 0.5, magnesium: 15,
      va: 0, vc: 0, vd: 0, ve: 0.8, b1: 0.03, b2: 0.02, niacin: 0.1,
    }, [1, '杯', 250], ['无糖豆浆']],
  ['牛奶', '蛋白', [65, 3.3, 3.6, 4.9],
    {
      fiber: 0, sugar: 4.9, sodium: 37.2,
      potassium: 109, calcium: 104, iron: 0.3, zinc: 0.42, selenium: 1.9, magnesium: 11,
      va: 24, vc: 1, vd: 0.1, ve: 0.21, b1: 0.03, b2: 0.14, niacin: 0.1,
    }, [1, '杯', 250], ['纯牛奶', '全脂牛奶']],
  ['酸奶', '蛋白', [72, 2.5, 2.7, 9.3],
    {
      fiber: 0, sugar: 9.3, sodium: 39,
      potassium: 150, calcium: 118, iron: 0.4, zinc: 0.5, selenium: 1.7, magnesium: 12,
      va: 26, vc: 1, vd: 0, ve: 0.12, b1: 0.03, b2: 0.15, niacin: 0.2,
    }, [1, '杯', 150], ['原味酸奶', '无糖酸奶']],

  // ── 蔬菜 ──
  ['番茄', '蔬菜', [20, 0.9, 0.2, 4],
    {
      fiber: 0.5, sodium: 5,
      potassium: 163, calcium: 10, iron: 0.4, zinc: 0.13, selenium: 0.15, magnesium: 9,
      va: 92, vc: 19, vd: 0, ve: 0.57, b1: 0.03, b2: 0.03, niacin: 0.6,
    }, [1, '个', 150], ['西红柿']],
  ['黄瓜', '蔬菜', [16, 0.8, 0.2, 2.9],
    {
      fiber: 0.5, sodium: 4.9,
      potassium: 102, calcium: 24, iron: 0.5, zinc: 0.18, selenium: 0.4, magnesium: 15,
      va: 15, vc: 9, vd: 0, ve: 0.49, b1: 0.02, b2: 0.03, niacin: 0.2,
    }, [1, '根', 200], ['青瓜', '小黄瓜', '水果黄瓜']],
  ['西兰花', '蔬菜', [36, 4.1, 0.6, 4.3],
    {
      fiber: 1.6, sodium: 18.8,
      // 钾原填 17 是旧表的错值（比白菜还低，与 293mg 的实际含量差 17 倍），已按成分表订正
      potassium: 293, calcium: 67, iron: 1.0, zinc: 0.41, selenium: 0.7, magnesium: 18,
      va: 1202, vc: 51, vd: 0, ve: 0.91, b1: 0.07, b2: 0.11, niacin: 0.9,
    }, [1, '份', 150], ['西蓝花', '绿花菜']],
  ['菠菜', '蔬菜', [28, 2.6, 0.3, 4.5],
    {
      fiber: 1.7, sodium: 85.2,
      potassium: 311, calcium: 66, iron: 2.9, zinc: 0.85, selenium: 0.97, magnesium: 58,
      va: 487, vc: 32, vd: 0, ve: 1.74, b1: 0.04, b2: 0.11, niacin: 0.6,
    }, [1, '份', 150]],
  ['生菜', '蔬菜', [15, 1.3, 0.3, 2],
    {
      fiber: 0.7, sodium: 32.8,
      potassium: 170, calcium: 34, iron: 0.9, zinc: 0.2, selenium: 0.5, magnesium: 18,
      va: 60, vc: 13, vd: 0, ve: 0.3, b1: 0.03, b2: 0.05, niacin: 0.4,
    }, [1, '份', 100], ['圆生菜', '球生菜', '油麦菜', '莜麦菜']],
  ['白菜', '蔬菜', [17, 1.5, 0.1, 3.2],
    {
      fiber: 0.8, sodium: 57.5,
      potassium: 130, calcium: 50, iron: 0.7, zinc: 0.38, selenium: 0.5, magnesium: 11,
      va: 20, vc: 31, vd: 0, ve: 0.36, b1: 0.04, b2: 0.05, niacin: 0.6,
    }, [1, '份', 150], ['大白菜', '娃娃菜']],

  // ── 水果 ──
  ['苹果', '水果', [53, 0.4, 0.2, 13.7],
    {
      fiber: 1.7, sugar: 10.3, sodium: 1.6,
      potassium: 119, calcium: 4, iron: 0.3, zinc: 0.1, selenium: 0.1, magnesium: 4,
      va: 3, vc: 4, vd: 0, ve: 0.4, b1: 0.06, b2: 0.02, niacin: 0.2,
    }, [1, '个', 200]],
  ['香蕉', '水果', [93, 1.4, 0.2, 22],
    {
      fiber: 1.2, sugar: 15.8, sodium: 0.8,
      potassium: 256, calcium: 7, iron: 0.4, zinc: 0.18, selenium: 0.6, magnesium: 43,
      va: 10, vc: 8, vd: 0, ve: 0.24, b1: 0.02, b2: 0.04, niacin: 0.7,
    }, [1, '根', 120]],
  ['橙子', '水果', [48, 0.8, 0.2, 11.1],
    {
      fiber: 0.6, sugar: 9.4, sodium: 1.2,
      potassium: 159, calcium: 20, iron: 0.4, zinc: 0.14, selenium: 0.3, magnesium: 14,
      va: 27, vc: 33, vd: 0, ve: 0.56, b1: 0.05, b2: 0.04, niacin: 0.4,
    }, [1, '个', 200], ['脐橙', '甜橙']],
  ['蓝莓', '水果', [57, 0.7, 0.3, 14.5],
    {
      fiber: 2.4, sugar: 10, sodium: 1,
      potassium: 77, calcium: 6, iron: 0.2, zinc: 0.1, selenium: 0.1, magnesium: 6,
      va: 1, vc: 9.7, vd: 0, ve: 0.57, b1: 0.03, b2: 0.04, niacin: 0.4,
    }, [1, '份', 100]],

  // ── 坚果 / 油脂 / 调味 ──
  ['核桃', '坚果', [646, 14.9, 58.8, 19.1],
    {
      fiber: 9.5, sodium: 6.4,
      potassium: 385, calcium: 56, iron: 2.7, zinc: 2.2, selenium: 4.6, magnesium: 131,
      va: 5, vc: 1, vd: 0, ve: 43.2, b1: 0.15, b2: 0.14, niacin: 1.0,
    }, [1, '小把', 25]],
  ['花生', '坚果', [601, 21.7, 48, 23.8],
    {
      fiber: 6.3, sodium: 3.6,
      potassium: 587, calcium: 47, iron: 1.5, zinc: 2.5, selenium: 3.4, magnesium: 171,
      va: 0, vc: 0, vd: 0, ve: 18.1, b1: 0.13, b2: 0.1, niacin: 14.1,
    }, [1, '小把', 25], ['炒花生', '花生米']],
  ['大豆油', '油脂', [899, 0, 99.9, 0],
    {
      // 精炼植物油：13 项微量里只有维生素 E 有实际含量，其余是真实的 0 而非未知
      fiber: 0, sodium: 0,
      potassium: 0, calcium: 0, iron: 0, zinc: 0, selenium: 0, magnesium: 0,
      va: 0, vc: 0, vd: 0, ve: 93.1, b1: 0, b2: 0, niacin: 0,
    }, [1, '勺', 10], ['食用油', '植物油', '花生油', '菜籽油', '调和油']],
  ['白砂糖', '调味', [400, 0, 0, 99.9],
    {
      fiber: 0, sugar: 99.9, sodium: 0.4,
      potassium: 1, calcium: 1, iron: 0.1, zinc: 0, selenium: 0, magnesium: 0,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0, b2: 0, niacin: 0,
    }, [1, '勺', 8], ['白糖', '绵白糖']],
  ['生抽', '调味', [66, 5.6, 0.1, 10.1],
    {
      fiber: 0, sodium: 5757,
      potassium: 337, calcium: 66, iron: 8.6, zinc: 0.4, selenium: 0.5, magnesium: 30,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0.02, b2: 0.1, niacin: 1.5,
    }, [1, '勺', 10], ['酱油', '生抽酱油']],
  ['食盐', '调味', [0, 0, 0, 0],
    {
      fiber: 0, sodium: 39311,
      potassium: 1, calcium: 1, iron: 0.1, zinc: 0.1, selenium: 0, magnesium: 0,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0, b2: 0, niacin: 0,
    }, [1, '小勺', 5], ['精盐', '食用盐']],

  // ── 饮料 ──
  ['可乐', '饮料', [43, 0, 0, 10.8],
    {
      fiber: 0, sugar: 10.8, sodium: 4,
      potassium: 1, calcium: 2, iron: 0.1, zinc: 0.1, selenium: 0, magnesium: 1,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0, b2: 0, niacin: 0,
    }, [1, '罐', 330], ['可口可乐', '百事可乐']],
  ['无糖可乐', '饮料', [0.2, 0, 0, 0],
    {
      fiber: 0, sugar: 0, sodium: 10,
      potassium: 1, calcium: 2, iron: 0, zinc: 0, selenium: 0, magnesium: 1,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0, b2: 0, niacin: 0,
    }, [1, '罐', 330], ['零度可乐', '健怡可乐']],
  ['美式咖啡', '饮料', [1, 0.1, 0, 0],
    {
      fiber: 0, sodium: 2,
      potassium: 49, calcium: 2, iron: 0.1, zinc: 0.1, selenium: 0, magnesium: 5,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0, b2: 0, niacin: 0.5,
    }, [1, '杯', 350], ['黑咖啡', '咖啡']],
  ['啤酒', '饮料', [32, 0.4, 0, 3.1],
    {
      fiber: 0, sodium: 11,
      potassium: 47, calcium: 4, iron: 0.1, zinc: 0.1, selenium: 0.5, magnesium: 8,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0.01, b2: 0.03, niacin: 0.6,
    }, [1, '瓶', 500]],

  // ── 常见家常菜（已含烹调油，per100g） ──
  ['番茄炒蛋', '家常菜', [96, 5.6, 6.4, 4.5],
    {
      fiber: 0.6, sodium: 350,
      potassium: 210, calcium: 30, iron: 0.8, zinc: 0.5, selenium: 4, magnesium: 12,
      va: 90, vc: 12, vd: 0.1, ve: 1.2, b1: 0.05, b2: 0.12, niacin: 0.5,
    }, [1, '盘', 250]],
  ['宫保鸡丁', '家常菜', [174, 13, 10, 8.5],
    {
      fiber: 0.9, sodium: 600,
      potassium: 250, calcium: 25, iron: 1.2, zinc: 1.1, selenium: 6, magnesium: 25,
      va: 30, vc: 3, vd: 0.1, ve: 1.8, b1: 0.08, b2: 0.1, niacin: 5,
    }, [1, '盘', 200]],
  ['红烧肉', '家常菜', [460, 9.5, 44, 3],
    {
      fiber: 0.1, sodium: 550,
      potassium: 180, calcium: 8, iron: 1.2, zinc: 1.4, selenium: 6, magnesium: 12,
      va: 15, vc: 0, vd: 0.2, ve: 0.4, b1: 0.3, b2: 0.1, niacin: 2.5,
    }, [1, '碗', 250]],
  ['鱼香肉丝', '家常菜', [190, 11, 12, 9],
    {
      fiber: 0.9, sodium: 650,
      potassium: 240, calcium: 20, iron: 1.3, zinc: 1.4, selenium: 6, magnesium: 20,
      va: 25, vc: 5, vd: 0.1, ve: 1.5, b1: 0.2, b2: 0.1, niacin: 3,
    }, [1, '盘', 200]],
  ['麻婆豆腐', '家常菜', [130, 8.5, 9, 4],
    {
      fiber: 0.6, sodium: 600,
      potassium: 140, calcium: 110, iron: 1.5, zinc: 0.8, selenium: 2, magnesium: 45,
      va: 8, vc: 1, vd: 0, ve: 2.2, b1: 0.05, b2: 0.05, niacin: 0.5,
    }, [1, '盘', 200]],
  ['酸辣土豆丝', '家常菜', [105, 1.9, 6.2, 11],
    {
      fiber: 1, sodium: 420,
      potassium: 290, calcium: 12, iron: 0.6, zinc: 0.3, selenium: 0.5, magnesium: 18,
      va: 2, vc: 18, vd: 0, ve: 0.7, b1: 0.07, b2: 0.03, niacin: 0.8,
    }, [1, '盘', 200]],
  ['蒜蓉炒青菜', '家常菜', [62, 1.8, 4.5, 4],
    {
      fiber: 1.3, sodium: 320,
      potassium: 260, calcium: 80, iron: 1.4, zinc: 0.4, selenium: 0.6, magnesium: 25,
      va: 220, vc: 25, vd: 0, ve: 1.3, b1: 0.05, b2: 0.08, niacin: 0.6,
    }, [1, '盘', 200], ['清炒时蔬', '炒青菜']],
  ['可乐鸡翅', '家常菜', [215, 16, 12, 10],
    {
      fiber: 0, sodium: 620,
      potassium: 190, calcium: 12, iron: 1.0, zinc: 1.2, selenium: 8, magnesium: 18,
      va: 20, vc: 0, vd: 0.1, ve: 0.6, b1: 0.05, b2: 0.15, niacin: 3,
    }, [1, '盘', 200]],

  // ── 真实照片补充（2026-10-22，6 张实拍验证时补的缺口） ──
  // 注意：新条目一律追加在数组末尾，不插到上面的分类里。
  // 原因是 id = preset_{序号}，往前插会让所有既有 preset 的 id 位移，
  // 而 MealItem.foodId 和三档学习样本 (biasSamples) 都按 id 关联 —— 位移等于张冠李戴。
  ['米粉', '主食', [110, 2.6, 0.3, 24.9],
    {
      fiber: 0.4, sodium: 6,
      potassium: 22, calcium: 10, iron: 0.5, zinc: 0.4, selenium: 2, magnesium: 10,
      va: 0, vc: 0, vd: 0, ve: 0.1, b1: 0.02, b2: 0.01, niacin: 0.3,
    }, [1, '碗', 250], ['河粉', '米线', '长沙米粉', '桂林米粉']],
  ['面窝', '主食', [381, 6.4, 22, 40],
    {
      fiber: 1.2, sodium: 420,
      potassium: 80, calcium: 25, iron: 1.5, zinc: 0.6, selenium: 3, magnesium: 20,
      // 油炸面食，维生素 E 主要来自炸制用油
      va: 0, vc: 0, vd: 0, ve: 3.5, b1: 0.1, b2: 0.05, niacin: 1.2,
    }, [1, '个', 80], ['油饼', '葱油饼', '炸糕', '面圈', '油炸面圈', '炸面圈']],
  ['蛋饺', '蛋白', [190, 12, 13, 7],
    {
      fiber: 0, sodium: 480,
      potassium: 130, calcium: 40, iron: 1.4, zinc: 1.2, selenium: 6, magnesium: 12,
      va: 110, vc: 0, vd: 0.6, ve: 1.2, b1: 0.06, b2: 0.15, niacin: 0.5,
    }, [1, '个', 20], ['蛋卷', '蛋皮肉饺']],
  ['牛腩', '蛋白', [200, 18, 14, 1],
    {
      fiber: 0, sodium: 60,
      potassium: 250, calcium: 8, iron: 2.6, zinc: 4.5, selenium: 8, magnesium: 18,
      va: 8, vc: 0, vd: 0.1, ve: 0.5, b1: 0.05, b2: 0.14, niacin: 3.5,
    }, [1, '份', 120], ['牛肋条', '牛腩肉', '肥牛腩']],
  ['卤牛肉', '蛋白', [246, 31.4, 11.9, 3.2],
    {
      fiber: 0, sodium: 869,
      potassium: 220, calcium: 14, iron: 3.2, zinc: 7, selenium: 15, magnesium: 20,
      va: 8, vc: 0, vd: 0.1, ve: 0.5, b1: 0.06, b2: 0.2, niacin: 4,
    }, [1, '份', 100], ['酱牛肉', '卤牛腱', '牛肉片', '五香牛肉']],
  ['腊肠', '蛋白', [508, 22, 41, 12],
    {
      fiber: 0, sodium: 1420,
      potassium: 410, calcium: 20, iron: 2.5, zinc: 3, selenium: 12, magnesium: 22,
      va: 30, vc: 0, vd: 0.5, ve: 1.5, b1: 0.5, b2: 0.2, niacin: 4,
    }, [1, '根', 60], ['香肠', '广式腊肠', '腊肉肠', '自制香肠', '红肠']],
  ['腊肉', '蛋白', [498, 11.8, 48.8, 2.9],
    {
      fiber: 0, sodium: 1620,
      potassium: 320, calcium: 22, iron: 2.4, zinc: 2.8, selenium: 10, magnesium: 20,
      va: 40, vc: 0, vd: 0.5, ve: 2, b1: 0.4, b2: 0.16, niacin: 3.2,
    }, [1, '份', 60], ['咸肉', '火腿', '培根']],
  ['杏鲍菇', '蔬菜', [35, 1.3, 0.1, 8.3],
    {
      fiber: 2.1, sodium: 3,
      potassium: 242, calcium: 3, iron: 0.5, zinc: 0.5, selenium: 1.5, magnesium: 11,
      va: 0, vc: 2, vd: 0.3, ve: 0.6, b1: 0.05, b2: 0.1, niacin: 3,
    }, [1, '份', 100], ['鸡腿菇', '刺芹侧耳']],
  ['香菇', '蔬菜', [26, 2.2, 0.3, 5.2],
    {
      fiber: 3.3, sodium: 1.4,
      potassium: 20, calcium: 2, iron: 0.3, zinc: 0.66, selenium: 2.6, magnesium: 11,
      // 鲜香菇的维生素 D 很低（0.6μg），干香菇经日晒可到十几微克 —— 两者必须分开建条目，
      // 否则「干香菇」会被这一步匹配到鲜香菇，维生素 D 一项少算 20 倍
      vd: 0.6, va: 0, vc: 1, ve: 0.66, b1: 0.08, b2: 0.08, niacin: 2,
    }, [1, '份', 100], ['冬菇', '鲜香菇']],
  ['虫草花', '蔬菜', [292, 21, 4, 44],
    {
      // 干品口径（serving 15g 即一次煲汤量），不是鲜重
      fiber: 12, sodium: 30,
      potassium: 1200, calcium: 60, iron: 8, zinc: 4, selenium: 5, magnesium: 120,
      va: 0, vc: 0, vd: 0, ve: 2, b1: 0.3, b2: 0.6, niacin: 5,
    }, [1, '份', 15], ['蛹虫草', '北虫草']],
  ['猕猴桃', '水果', [61, 0.8, 0.6, 14.5],
    {
      fiber: 2.6, sugar: 9, sodium: 10,
      potassium: 145, calcium: 27, iron: 0.3, zinc: 0.6, selenium: 0.5, magnesium: 12,
      va: 22, vc: 62, vd: 0, ve: 1.46, b1: 0.05, b2: 0.02, niacin: 0.3,
    }, [1, '个', 90], ['奇异果', '猕猴桃果']],

  // ── 微量专项补充（2026-10-22）──
  // 动因：13 项微矿单项覆盖率原在 5%（VD）~ 68%（钙）之间，远低于 50% 的
  // 「可判定」门槛，导致今日页微量版块几乎全显示「—」。
  // 这里补的是「某一项的决定性来源」—— 少了它们，那项再怎么吃都补不满：
  // 肝脏（VA/铁/B2）、海鱼（VD/硒）、菌藻（VD/碘/铁）、油籽（VE/钙/镁）、贝类（锌）。
  ['猪肝', '蛋白', [129, 19.3, 3.5, 5.0],
    {
      fiber: 0, sodium: 68,
      potassium: 235, calcium: 6, iron: 22.6, zinc: 5.78, selenium: 19.2, magnesium: 24,
      // 维生素 A 的全国头号来源，一份 50g 就有 2486μgRAE（成人 RNI 的 3 倍），
      // 孕妇需在 UI 提示不宜过量 —— DRI 的 UL 是 3000μgRAE
      va: 4972, vc: 20, vd: 1.0, ve: 0.86, b1: 0.21, b2: 2.08, niacin: 15,
    }, [1, '份', 50], ['猪肝片', '卤猪肝', '炒猪肝']],
  ['鸡肝', '蛋白', [121, 16.6, 4.8, 2.8],
    {
      fiber: 0, sodium: 92,
      potassium: 220, calcium: 7, iron: 9.6, zinc: 2.4, selenium: 38, magnesium: 16,
      va: 10414, vc: 0, vd: 0.5, ve: 1.88, b1: 0.33, b2: 1.1, niacin: 11.9,
    }, [1, '份', 50], ['鸡肝片', '卤鸡肝']],
  ['胡萝卜', '蔬菜', [39, 1.0, 0.2, 8.8],
    {
      fiber: 3.2, sodium: 71,
      potassium: 190, calcium: 32, iron: 1.0, zinc: 0.23, selenium: 0.6, magnesium: 14,
      // 植物性 β-胡萝卜素，吸收率约 1/12，但仍是蔬菜里最稳的 VA 来源
      va: 688, vc: 13, vd: 0, ve: 0.41, b1: 0.04, b2: 0.03, niacin: 0.6,
    }, [1, '根', 150], ['红萝卜', '甘荀', '胡萝卜丝']],
  ['南瓜', '蔬菜', [23, 0.7, 0.1, 5.3],
    {
      fiber: 0.8, sodium: 0.8,
      potassium: 145, calcium: 16, iron: 0.4, zinc: 0.14, selenium: 0.4, magnesium: 8,
      va: 148, vc: 8, vd: 0, ve: 0.36, b1: 0.03, b2: 0.04, niacin: 0.4,
    }, [1, '份', 150], ['倭瓜', '老南瓜', '贝贝南瓜']],
  ['三文鱼', '蛋白', [139, 17.2, 7.8, 0],
    {
      fiber: 0, sodium: 63,
      potassium: 361, calcium: 9, iron: 0.3, zinc: 0.36, selenium: 24, magnesium: 27,
      // 少数能一顿吃够 VD 的日常食材（11μg/100g ≈ 一日 RNI）
      va: 12, vc: 0, vd: 11, ve: 0.7, b1: 0.15, b2: 0.13, niacin: 8.5,
    }, [1, '份', 120], ['大西洋鲑', '鲑鱼', '三文鱼刺身']],
  ['带鱼', '蛋白', [127, 17.7, 4.9, 3.1],
    {
      fiber: 0, sodium: 150,
      potassium: 280, calcium: 28, iron: 1.2, zinc: 0.7, selenium: 36, magnesium: 43,
      va: 29, vc: 0, vd: 8.3, ve: 0.8, b1: 0.02, b2: 0.06, niacin: 2.8,
    }, [1, '段', 80], ['刀鱼', '白带鱼', '红烧带鱼']],
  ['干香菇', '蔬菜', [274, 20, 1.2, 61.7],
    {
      // 干品。碳水 61.7g 是总碳水（含膳食纤维 31.6），4/4/9 反推会天然偏高，
      // 见 match.test.ts 的高纤维干货白名单
      fiber: 31.6, sodium: 45,
      potassium: 464, calcium: 83, iron: 10.5, zinc: 8.6, selenium: 6.4, magnesium: 147,
      // 晒干过程生成麦角钙化醇，是素食者唯一的天然 VD 来源
      va: 0, vc: 1, vd: 16, ve: 3.5, b1: 0.2, b2: 1.2, niacin: 20,
    }, [1, '份', 10], ['香菇干', '花菇', '干冬菇', '花菇干']],
  ['牡蛎', '蛋白', [73, 5.3, 2.1, 8.2],
    {
      fiber: 0, sodium: 462,
      potassium: 200, calcium: 131, iron: 7, zinc: 9.39, selenium: 86, magnesium: 65,
      // 锌含量是全部常见食材第一（是牛肉的 2.5 倍），一份 100g 覆盖成人 RNI 75%
      va: 27, vc: 0, vd: 0, ve: 0.7, b1: 0.01, b2: 0.05, niacin: 1.4,
    }, [1, '份', 100], ['生蚝', '海蛎子']],
  ['杏仁', '坚果', [578, 22.5, 45.4, 23.9],
    {
      fiber: 12.2, sodium: 8,
      potassium: 733, calcium: 97, iron: 3.9, zinc: 4.3, selenium: 4.1, magnesium: 178,
      va: 0, vc: 0, vd: 0, ve: 18.5, b1: 0.2, b2: 0.6, niacin: 3.4,
    }, [1, '小把', 25], ['巴旦木', '大杏仁', '美国大杏仁']],
  ['黑芝麻', '坚果', [559, 19.1, 46.1, 24],
    {
      fiber: 14, sodium: 8.3,
      // 钙 780mg/100g，是植物性食材里最高的之一（但吸收率受植酸影响，约 20%）
      potassium: 358, calcium: 780, iron: 22.7, zinc: 6.1, selenium: 4.7, magnesium: 290,
      va: 0, vc: 0, vd: 0, ve: 50.4, b1: 0.66, b2: 0.24, niacin: 5.9,
    }, [1, '勺', 10], ['芝麻', '芝麻粉', '黑芝麻粉']],
  ['紫菜', '蔬菜', [250, 26.7, 1.1, 44.1],
    {
      // 干品，serving 5g 是一张紫菜蛋花汤的量
      fiber: 21.6, sodium: 710,
      potassium: 1796, calcium: 264, iron: 54.9, zinc: 2.5, selenium: 7.2, magnesium: 105,
      va: 228, vc: 2, vd: 0, ve: 1.8, b1: 0.27, b2: 1.02, niacin: 7.3,
    }, [1, '份', 5], ['海苔', '紫菜干', '头水紫菜']],
  ['木耳', '蔬菜', [265, 12.1, 1.5, 65.6],
    {
      // 干品，serving 5g 是泡发前的一次用量
      fiber: 29.9, sodium: 48,
      potassium: 757, calcium: 247, iron: 97.4, zinc: 3.2, selenium: 3.7, magnesium: 152,
      va: 17, vc: 1, vd: 0, ve: 11.3, b1: 0.17, b2: 0.44, niacin: 2.5,
    }, [1, '份', 5], ['黑木耳', '云耳', '木耳丝']],
  ['虾皮', '调味', [153, 30.7, 2.2, 2.5],
    {
      fiber: 0, sodium: 5057,
      // 钙 991mg/100g：中国厨房里最廉价的补钙手段，但一勺（5g）就带 253mg 钠
      potassium: 617, calcium: 991, iron: 6.7, zinc: 1.9, selenium: 74, magnesium: 265,
      va: 19, vc: 0, vd: 0, ve: 0.9, b1: 0.02, b2: 0.14, niacin: 3.9,
    }, [1, '勺', 5], ['虾米', '海米', '小虾皮']],
  ['豆腐干', '蛋白', [140, 16.2, 3.6, 11.5],
    {
      fiber: 0.8, sodium: 330,
      potassium: 140, calcium: 308, iron: 4.9, zinc: 1.7, selenium: 2, magnesium: 64,
      va: 0, vc: 0, vd: 0, ve: 0.9, b1: 0.03, b2: 0.05, niacin: 0.3,
    }, [1, '份', 100], ['香干', '白干', '豆干']],
  ['葵花籽油', '油脂', [899, 0, 99.9, 0],
    {
      fiber: 0, sodium: 0,
      potassium: 0, calcium: 0, iron: 0, zinc: 0, selenium: 0, magnesium: 0,
      // 维生素 E 含量最高的日常食用油（54.6mg/100g，一勺 10g 就到 RNI 的 39%）
      va: 0, vc: 0, vd: 0, ve: 54.6, b1: 0, b2: 0, niacin: 0,
    }, [1, '勺', 10], ['瓜子油', '葵花油']],

  // ── 实拍验证的缺口（2026-10-22 第二轮，6 张图命中率 80%）──
  // 提示词里已经明写「带酥壳的炸鸡多为鸡腿肉 181kcal，不要默认填鸡胸」，
  // 但库里只有鸡胸肉 —— AI 老老实实报了「鸡腿肉」，匹配却是空的。
  ['鸡腿肉', '蛋白', [181, 16, 13, 0.7],
    {
      fiber: 0, sodium: 64,
      potassium: 220, calcium: 6, iron: 1.3, zinc: 1.1, selenium: 12, magnesium: 20,
      va: 44, vc: 0, vd: 0.2, ve: 0.22, b1: 0.08, b2: 0.16, niacin: 4.5,
    }, [1, '个', 120], ['鸡腿', '去骨鸡腿', '鸡腿排', '琵琶腿', '炸鸡腿', '去皮鸡腿', '去皮鸡腿肉']],
  ['小葱', '蔬菜', [27, 1.7, 0.3, 5.4],
    {
      // 单次用量 5g 上下，热量可忽略，但它是汤面/炒菜里出现频率最高的配菜之一，
      // 缺这一条会让每碗面都少一项微矿覆盖
      fiber: 1.3, sodium: 10.4,
      potassium: 143, calcium: 72, iron: 1.3, zinc: 0.35, selenium: 0.6, magnesium: 18,
      va: 42, vc: 22, vd: 0, ve: 0.3, b1: 0.03, b2: 0.05, niacin: 0.4,
    }, [1, '把', 5], ['葱花', '香葱', '大葱']],

  // ─── 扩展库 v7（USDA SR Legacy 2018-04，CC0；4 条与 9 项 VE 用中国食物成分表第6版） ───
  // VE 补值来源：中国食物成分表（白萝卜 .92/冬瓜 .08/莲藕 .73/苦瓜 .85/茼蒿 .92/苋菜 1.54 为紫苋/毛豆 2.44/黄豆芽 .80/扇贝 11.85）
  // USDA 对这几项报 0 或空行，是检测空白而非真零 —— 按纪律不能填 0，改用成分表值。
  ['藜麦', '主食', [368, 14.1, 6.07, 64.2],
    {
      fiber: 7, sodium: 5,
      potassium: 563, calcium: 47, iron: 4.57, zinc: 3.1, selenium: 8.5, magnesium: 197,
      va: 1, vd: 0, ve: 2.44, b1: 0.36, b2: 0.32, niacin: 1.52,
    }, [1, '份', 50], ['藜麦米', '奎奴亚藜']],
  ['荞麦面', '主食', [335, 12.6, 3.1, 70.6],
    {
      fiber: 10, sodium: 11,
      potassium: 577, calcium: 41, iron: 4.06, zinc: 3.12, selenium: 5.7, magnesium: 251,
      va: 0, vc: 0, vd: 0, ve: 0.32, b1: 0.42, b2: 0.19, niacin: 6.15,
    }, [1, '份', 50], ['荞麦面条', '荞面', '苦荞面']],
  ['糯米', '主食', [370, 6.81, 0.55, 81.7],
    {
      fiber: 2.8, sodium: 7,
      potassium: 77, calcium: 11, iron: 1.6, zinc: 1.2, selenium: 15.1, magnesium: 23,
      va: 0, vc: 0, vd: 0, b1: 0.18, b2: 0.06, niacin: 2.15,
    }, [1, '份', 50], ['江米', '圆糯米', '长糯米']],
  ['绿豆', '主食', [347, 23.9, 1.15, 62.6],
    {
      fiber: 16.3, sodium: 15,
      potassium: 1246, calcium: 132, iron: 6.74, zinc: 2.68, selenium: 8.2, magnesium: 189,
      va: 6, vc: 4.8, vd: 0, ve: 0.51, b1: 0.62, b2: 0.23, niacin: 2.25,
    }, [1, '份', 50], ['青小豆', '绿豆粒']],
  ['红豆', '主食', [329, 19.9, 0.53, 62.9],
    {
      fiber: 12.7, sodium: 5,
      potassium: 1254, calcium: 66, iron: 4.98, zinc: 5.04, selenium: 3.1, magnesium: 127,
      va: 1, vc: 0, vd: 0, b1: 0.46, b2: 0.22, niacin: 2.63,
    }, [1, '份', 50], ['赤小豆', '红小豆']],
  ['黄豆', '主食', [446, 36.5, 19.9, 30.2],
    {
      fiber: 9.3, sodium: 2,
      potassium: 1797, calcium: 277, iron: 15.7, zinc: 4.89, selenium: 17.8, magnesium: 280,
      va: 1, vc: 6, vd: 0, ve: 0.85, b1: 0.87, b2: 0.87, niacin: 1.62,
    }, [1, '份', 50], ['大豆', '黄大豆']],
  ['白面包', '主食', [266, 8.85, 3.33, 49.4],
    {
      fiber: 2.7, sodium: 490,
      potassium: 126, calcium: 144, iron: 3.61, zinc: 0.74, selenium: 22, magnesium: 23,
      va: 0, vc: 0, vd: 0, ve: 0.22, b1: 0.53, b2: 0.24, niacin: 4.78,
    }, [2, '片', 60], ['吐司', '白吐司', '土司', '切片面包']],
  ['玉米面', '主食', [361, 6.93, 3.86, 76.9],
    {
      fiber: 7.3, sodium: 5,
      potassium: 315, calcium: 7, iron: 2.38, zinc: 1.73, selenium: 15.4, magnesium: 93,
      va: 11, vc: 0, vd: 0, ve: 0.42, b1: 0.25, b2: 0.08, niacin: 1.9,
    }, [1, '份', 50], ['玉米粉', '棒子面', '苞米面']],
  ['山药', '主食', [57, 1.9, 0.2, 12.4],
    {
      fiber: 0.8, sodium: 18.6,
      potassium: 213, calcium: 16, iron: 0.3, zinc: 0.27, selenium: 0.55, magnesium: 20,
      va: 3, vc: 5, vd: 0, ve: 0.24, b1: 0.05, b2: 0.02, niacin: 0.3,
    }, [1, '份', 150], ['淮山', '怀山药', '铁棍山药', '薯蓣']],
  ['羊肉', '蛋白', [201, 18.6, 13.5, 0],
    {
      fiber: 0, sodium: 57,
      potassium: 261, calcium: 8, iron: 1.71, zinc: 3.5, selenium: 21.4, magnesium: 24,
      va: 0, vc: 0, ve: 0.21, b1: 0.13, b2: 0.23, niacin: 6.22,
    }, [1, '份', 100], ['羊肉片', '羊腿肉', '羔羊肉']],
  ['鸭肉', '蛋白', [240, 15.5, 19.7, 0.2],
    {
      sodium: 69,
      potassium: 191, calcium: 6, iron: 2.2, zinc: 1.33, selenium: 12.3, magnesium: 14,
      va: 52, vc: 0, ve: 0.27, b1: 0.08, b2: 0.22, niacin: 4.2,
    }, [1, '份', 100], ['鸭腿肉', '鸭块', '烤鸭肉']],
  ['鹅肉', '蛋白', [161, 22.8, 7.13, 0],
    {
      fiber: 0, sodium: 87,
      potassium: 420, calcium: 13, iron: 2.57, zinc: 2.34, selenium: 16.8, magnesium: 24,
      va: 12, vc: 7.2, b1: 0.13, b2: 0.38, niacin: 4.28,
    }, [1, '份', 100], ['鹅肉块', '大鹅']],
  ['排骨', '蛋白', [277, 15.5, 23.4, 0],
    {
      fiber: 0, sodium: 81,
      potassium: 242, calcium: 15, iron: 0.91, zinc: 2.5, selenium: 22, magnesium: 16,
      va: 0, vc: 0, vd: 2.3, ve: 0.37, b1: 0.32, b2: 0.25, niacin: 4.66,
    }, [1, '份', 120], ['猪排骨', '小排', '肋排', '排骨块']],
  ['猪蹄', '蛋白', [212, 23.2, 12.6, 0],
    {
      fiber: 0, sodium: 132,
      potassium: 63, calcium: 70, iron: 0.58, zinc: 0.76, selenium: 23.3, magnesium: 6,
      va: 0, vc: 0, ve: 0.02, b1: 0.03, b2: 0.11, niacin: 1.13,
    }, [1, '份', 150], ['猪脚', '猪手', '猪蹄块']],
  ['猪腰', '蛋白', [100, 16.5, 3.25, 0],
    {
      fiber: 0, sodium: 121,
      potassium: 229, calcium: 9, iron: 4.89, zinc: 2.75, selenium: 190, magnesium: 17,
      va: 59, vc: 13.3, b1: 0.34, b2: 1.7, niacin: 8.21,
    }, [1, '份', 100], ['猪肾', '腰花', '猪腰子']],
  ['牛肚', '蛋白', [85, 12.1, 3.69, 0],
    {
      fiber: 0, sodium: 97,
      potassium: 67, calcium: 69, iron: 0.59, zinc: 1.42, selenium: 12.5, magnesium: 13,
      va: 0, vc: 0, vd: 0, ve: 0.09, b2: 0.06, niacin: 0.88,
    }, [1, '份', 100], ['牛百叶', '毛肚', '牛胃']],
  ['鸡胗', '蛋白', [94, 17.7, 2.06, 0],
    {
      fiber: 0, sodium: 69,
      potassium: 237, calcium: 11, iron: 2.49, zinc: 2.72, selenium: 25.5, magnesium: 15,
      va: 19, vc: 3.7, ve: 0.33, b1: 0.03, b2: 0.23, niacin: 3.68,
    }, [1, '份', 100], ['鸡肫', '鸡胃', '鸡胗子']],
  ['鸭蛋', '蛋白', [185, 12.8, 13.8, 1.45],
    {
      fiber: 0, sodium: 146,
      potassium: 222, calcium: 64, iron: 3.85, zinc: 1.41, selenium: 36.4, magnesium: 17,
      va: 194, vc: 0, vd: 1.7, ve: 1.34, b1: 0.16, b2: 0.4, niacin: 0.2,
    }, [1, '个', 60], ['鸭蛋仁', '青皮鸭蛋']],
  ['鹌鹑蛋', '蛋白', [158, 13.1, 11.1, 0.41],
    {
      fiber: 0, sodium: 141,
      potassium: 132, calcium: 64, iron: 3.65, zinc: 1.47, selenium: 32, magnesium: 13,
      va: 156, vc: 0, vd: 1.4, ve: 1.08, b1: 0.13, b2: 0.79, niacin: 0.15,
    }, [1, '个', 10], ['鹑蛋', '鹌鹑蛋仁']],
  ['奶酪', '蛋白', [410, 24.3, 33.8, 2.13],
    {
      fiber: 0, sodium: 644,
      potassium: 76, calcium: 711, iron: 0.16, zinc: 3.74, selenium: 28.3, magnesium: 27,
      va: 263, vc: 0, vd: 1, ve: 0.78, b1: 0.03, b2: 0.43, niacin: 0.04,
    }, [1, '片', 20], ['芝士', '起司', '干酪', '切达奶酪']],
  ['奶粉', '蛋白', [496, 26.3, 26.7, 38.4],
    {
      fiber: 0, sodium: 371,
      potassium: 1330, calcium: 912, iron: 0.47, zinc: 3.34, selenium: 16.3, magnesium: 85,
      va: 258, vc: 8.6, vd: 10.5, ve: 0.58, b1: 0.28, b2: 1.21, niacin: 0.65,
    }, [2, '勺', 25], ['全脂奶粉', '乳粉', '奶粉冲剂']],
  ['淡奶油', '蛋白', [340, 2.84, 36.1, 2.84],
    {
      fiber: 0, sodium: 27,
      potassium: 95, calcium: 66, iron: 0.1, zinc: 0.24, selenium: 3, magnesium: 7,
      va: 411, vc: 0.6, vd: 1.6, ve: 0.92, b1: 0.02, b2: 0.19, niacin: 0.06,
    }, [2, '勺', 30], ['稀奶油', '鲜奶油', '动物奶油']],
  ['火腿', '蛋白', [157, 25.1, 5.5, 0],
    {
      fiber: 0, sodium: 1327,
      potassium: 316, calcium: 7, iron: 0.94, zinc: 2.57, selenium: 25.4, magnesium: 22,
      va: 0, vc: 0, vd: 0.9, ve: 0.26, b1: 0.68, b2: 0.25, niacin: 5.02,
    }, [1, '份', 100], ['火腿片', '火腿肉', '金华火腿']],
  ['鳕鱼', '蛋白', [82, 17.8, 0.67, 0],
    {
      fiber: 0, sodium: 54,
      potassium: 413, calcium: 16, iron: 0.38, zinc: 0.45, selenium: 33.1, magnesium: 32,
      va: 12, vc: 1, vd: 0.9, ve: 0.64, b1: 0.08, b2: 0.07, niacin: 2.06,
    }, [1, '份', 100], ['鳕鱼片', '大西洋鳕鱼', '银鳕鱼']],
  ['鲅鱼', '蛋白', [205, 18.6, 13.9, 0],
    {
      fiber: 0, sodium: 90,
      potassium: 314, calcium: 12, iron: 1.63, zinc: 0.63, selenium: 44.1, magnesium: 76,
      va: 50, vc: 0.4, vd: 16.1, ve: 1.52, b1: 0.18, b2: 0.31, niacin: 9.08,
    }, [1, '份', 100], ['马鲛鱼', '燕鱼']],
  ['鲤鱼', '蛋白', [127, 17.8, 5.6, 0],
    {
      fiber: 0, sodium: 49,
      potassium: 333, calcium: 41, iron: 1.24, zinc: 1.48, selenium: 12.6, magnesium: 29,
      va: 9, vc: 1.6, vd: 24.7, ve: 0.63, b1: 0.12, b2: 0.06, niacin: 1.64,
    }, [1, '份', 100], ['鲤子', '河鲤']],
  ['金枪鱼', '蛋白', [109, 24.4, 0.49, 0],
    {
      fiber: 0, sodium: 45,
      potassium: 441, calcium: 4, iron: 0.77, zinc: 0.37, selenium: 90.6, magnesium: 35,
      va: 18, vc: 0, vd: 1.7, ve: 0.24, b1: 0.12, b2: 0.12, niacin: 18.5,
    }, [1, '份', 100], ['吞拿鱼', '鲔鱼', '金枪鱼块']],
  ['鳗鱼', '蛋白', [184, 18.4, 11.7, 0],
    {
      fiber: 0, sodium: 51,
      potassium: 272, calcium: 20, iron: 0.5, zinc: 1.62, selenium: 6.5, magnesium: 20,
      va: 1043, vc: 1.8, vd: 23.3, ve: 4, b1: 0.15, b2: 0.04, niacin: 3.5,
    }, [1, '份', 100], ['白鳝', '鳗鲡', '河鳗']],
  ['螃蟹', '蛋白', [87, 18.1, 1.08, 0.04],
    {
      fiber: 0, sodium: 293,
      potassium: 329, calcium: 89, iron: 0.74, zinc: 3.54, selenium: 37.4, magnesium: 34,
      va: 2, vc: 3, b1: 0.08, b2: 0.04, niacin: 2.7,
    }, [1, '份', 100], ['河蟹', '大闸蟹', '梭子蟹', '蟹肉']],
  ['蛤蜊', '蛋白', [86, 14.7, 0.96, 3.57],
    {
      fiber: 0, sodium: 601,
      potassium: 46, calcium: 39, iron: 1.62, zinc: 0.51, selenium: 30.6, magnesium: 19,
      va: 90, vc: 0, vd: 0, ve: 0.68, b1: 0.02, b2: 0.04, niacin: 0.35,
    }, [1, '份', 100], ['花蛤', '文蛤', '蚬子', '蛤蜊肉']],
  ['扇贝', '蛋白', [69, 12.1, 0.49, 3.18],
    {
      fiber: 0, sodium: 392,
      potassium: 205, calcium: 6, iron: 0.38, zinc: 0.91, selenium: 12.8, magnesium: 22,
      va: 1, vc: 0, vd: 0, ve: 11.85, b1: 0.01, b2: 0.02, niacin: 0.7,
    }, [1, '份', 100], ['带子', '扇贝肉', '鲜贝']],
  ['鱿鱼', '蛋白', [92, 15.6, 1.38, 3.08],
    {
      fiber: 0, sodium: 44,
      potassium: 246, calcium: 32, iron: 0.68, zinc: 1.53, selenium: 44.8, magnesium: 33,
      va: 10, vc: 4.7, vd: 0, ve: 1.2, b1: 0.02, b2: 0.41, niacin: 2.17,
    }, [1, '份', 100], ['鱿鱼须', '枪乌贼', '鲜鱿']],
  ['茄子', '蔬菜', [25, 0.98, 0.18, 5.88],
    {
      fiber: 3, sodium: 2,
      potassium: 229, calcium: 9, iron: 0.23, zinc: 0.16, selenium: 0.3, magnesium: 14,
      va: 1, vc: 2.2, vd: 0, ve: 0.3, b1: 0.04, b2: 0.04, niacin: 0.65,
    }, [1, '份', 150], ['紫茄子', '长茄子', '圆茄子']],
  ['青椒', '蔬菜', [20, 0.86, 0.17, 4.64],
    {
      fiber: 1.7, sodium: 3,
      potassium: 175, calcium: 10, iron: 0.34, zinc: 0.13, magnesium: 10,
      va: 18, vc: 80.4, vd: 0, ve: 0.37, b1: 0.06, b2: 0.03, niacin: 0.48,
    }, [1, '份', 150], ['柿子椒', '菜椒', '甜椒', '青柿子椒']],
  ['洋葱', '蔬菜', [40, 1.1, 0.1, 9.34],
    {
      fiber: 1.7, sodium: 4,
      potassium: 146, calcium: 23, iron: 0.21, zinc: 0.17, selenium: 0.5, magnesium: 10,
      va: 0, vc: 7.4, vd: 0, ve: 0.02, b1: 0.05, b2: 0.03, niacin: 0.12,
    }, [1, '份', 150], ['圆葱', '葱头', '紫洋葱', '白洋葱']],
  ['芹菜', '蔬菜', [14, 0.69, 0.17, 2.97],
    {
      fiber: 1.6, sodium: 80,
      potassium: 260, calcium: 40, iron: 0.2, zinc: 0.13, selenium: 0.4, magnesium: 11,
      va: 22, vc: 3.1, vd: 0, ve: 0.27, b1: 0.02, b2: 0.06, niacin: 0.32,
    }, [1, '份', 150], ['西芹', '旱芹', '芹菜段']],
  // 能量取中国食物成分表 15kcal（USDA pak-choi 报 13，与 4/4/9 推算差 27% 会触发一致性断言）
  ['小白菜', '蔬菜', [15, 1.5, 0.2, 2.18],
    {
      fiber: 1, sodium: 65,
      potassium: 252, calcium: 105, iron: 0.8, zinc: 0.19, selenium: 0.5, magnesium: 19,
      va: 223, vc: 45, vd: 0, ve: 0.09, b1: 0.04, b2: 0.07, niacin: 0.5,
    }, [1, '份', 200], ['青菜', '上海青', '小油菜', '油菜', '鸡毛菜']],
  ['芦笋', '蔬菜', [20, 2.2, 0.12, 3.88],
    {
      fiber: 2.1, sodium: 2,
      potassium: 202, calcium: 24, iron: 2.14, zinc: 0.54, selenium: 2.3, magnesium: 14,
      va: 38, vc: 5.6, vd: 0, ve: 1.13, b1: 0.14, b2: 0.14, niacin: 0.98,
    }, [1, '份', 150], ['石刁柏', '芦笋尖']],
  ['豆角', '蔬菜', [31, 1.83, 0.22, 6.97],
    {
      fiber: 2.7, sodium: 6,
      potassium: 211, calcium: 37, iron: 1.03, zinc: 0.24, selenium: 0.6, magnesium: 25,
      va: 35, vc: 12.2, vd: 0, ve: 0.41, b1: 0.08, b2: 0.1, niacin: 0.73,
    }, [1, '份', 150], ['豇豆', '四季豆', '长豆角', '菜豆']],
  // 整条改用中国食物成分表：USDA 的冬瓜把钠报 111、纤维报 2.9、钾报 6，与成分表（1.8 / 0.7 / 78）差太远
  ['冬瓜', '蔬菜', [13, 0.4, 0.2, 2.6],
    {
      fiber: 0.7, sodium: 1.8,
      potassium: 78, calcium: 19, iron: 0.2, zinc: 0.07, selenium: 0.22, magnesium: 8,
      va: 13, vc: 18, vd: 0, ve: 0.08, b1: 0.01, b2: 0.01, niacin: 0.3,
    }, [1, '份', 200], ['白瓜', '冬瓜肉']],
  ['莲藕', '蔬菜', [74, 2.6, 0.1, 17.2],
    {
      fiber: 4.9, sodium: 40,
      potassium: 556, calcium: 45, iron: 1.16, zinc: 0.39, selenium: 0.7, magnesium: 23,
      va: 0, vc: 44, vd: 0, ve: 0.73, b1: 0.16, b2: 0.22, niacin: 0.4,
    }, [1, '份', 150], ['藕片', '莲菜', '藕段']],
  ['白萝卜', '蔬菜', [18, 0.6, 0.1, 4.1],
    {
      fiber: 1.6, sodium: 21,
      potassium: 227, calcium: 27, iron: 0.4, zinc: 0.15, selenium: 0.7, magnesium: 16,
      va: 0, vc: 22, vd: 0, ve: 0.92, b1: 0.02, b2: 0.02, niacin: 0.2,
    }, [1, '份', 200], ['萝卜', '莱菔', '白萝卜丝']],
  ['苦瓜', '蔬菜', [17, 1, 0.17, 3.7],
    {
      fiber: 2.8, sodium: 5,
      potassium: 296, calcium: 19, iron: 0.43, zinc: 0.8, selenium: 0.2, magnesium: 17,
      va: 24, vc: 84, vd: 0, ve: 0.85, b1: 0.04, b2: 0.04, niacin: 0.4,
    }, [1, '份', 150], ['凉瓜', '苦瓜片']],
  ['丝瓜', '蔬菜', [20, 1.2, 0.2, 4.35],
    {
      fiber: 1.1, sodium: 3,
      potassium: 139, calcium: 20, iron: 0.36, zinc: 0.07, selenium: 0.2, magnesium: 14,
      vc: 12, vd: 0, ve: 0.1, b1: 0.05, b2: 0.06, niacin: 0.4,
    }, [1, '份', 150], ['水瓜', '天丝瓜', '丝瓜片']],
  ['茼蒿', '蔬菜', [24, 3.36, 0.56, 3.02],
    {
      fiber: 3, sodium: 118,
      potassium: 567, calcium: 117, iron: 2.29, zinc: 0.71, magnesium: 32,
      va: 116, vc: 1.4, vd: 0, ve: 0.92, b1: 0.13, b2: 0.14, niacin: 0.53,
    }, [1, '份', 200], ['蓬蒿', '皇帝菜', '蒿子杆']],
  ['苋菜', '蔬菜', [23, 2.46, 0.33, 4.02],
    {
      fiber: 2.1, sodium: 20,
      potassium: 611, calcium: 215, iron: 2.32, zinc: 0.9, selenium: 0.9, magnesium: 55,
      va: 146, vc: 43.3, vd: 0, ve: 1.54, b1: 0.03, b2: 0.16, niacin: 0.66,
    }, [1, '份', 200], ['红苋菜', '青苋菜', '米苋']],
  ['豌豆', '蔬菜', [81, 5.42, 0.4, 14.5],
    {
      fiber: 5.7, sodium: 5,
      potassium: 244, calcium: 25, iron: 1.47, zinc: 1.24, selenium: 1.8, magnesium: 33,
      va: 38, vc: 40, vd: 0, ve: 0.13, b1: 0.27, b2: 0.13, niacin: 2.09,
    }, [1, '份', 150], ['青豌豆', '豌豆粒', '鲜豌豆']],
  ['毛豆', '蔬菜', [147, 13, 6.8, 11.1],
    {
      fiber: 4.2, sodium: 15,
      potassium: 620, calcium: 197, iron: 3.55, zinc: 0.99, selenium: 1.5, magnesium: 65,
      va: 9, vc: 29, vd: 0, ve: 2.44, b1: 0.44, b2: 0.18, niacin: 1.65,
    }, [1, '份', 150], ['毛豆仁', '枝豆', '青毛豆']],
  // 同黄豆芽：改用水发豆芽口径（USDA 30kcal 是发芽种子，成分表 18kcal 才是入口状态）
  ['绿豆芽', '蔬菜', [18, 2.1, 0.1, 2.9],
    {
      fiber: 0.8, sodium: 4.4,
      potassium: 68, calcium: 9, iron: 0.6, zinc: 0.35, selenium: 0.5, magnesium: 18,
      va: 3, vc: 6, vd: 0, b1: 0.05, b2: 0.06, niacin: 0.5,
    }, [1, '份', 150], ['银芽', '绿豆芽菜', '豆芽']],
  // 整条改用中国食物成分表「黄豆芽（水发）」：USDA 的 122kcal/13.1g 蛋白是干种子口径，
  // 中国人吃的豆芽含水 90% 以上，差 2.8 倍，会把一份豆芽记成一份肉。
  ['黄豆芽', '蔬菜', [44, 4.5, 1.6, 4.5],
    {
      fiber: 1.5, sodium: 7.2,
      potassium: 160, calcium: 21, iron: 0.6, zinc: 0.54, selenium: 0.96, magnesium: 21,
      va: 5, vc: 8, vd: 0, ve: 0.8, b1: 0.04, b2: 0.07, niacin: 0.6,
    }, [1, '份', 150], ['大豆芽', '黄豆芽菜']],
  ['花菜', '蔬菜', [25, 1.92, 0.28, 4.97],
    {
      fiber: 2, sodium: 30,
      potassium: 299, calcium: 22, iron: 0.42, zinc: 0.27, selenium: 0.6, magnesium: 15,
      va: 0, vc: 48.2, vd: 0, ve: 0.08, b1: 0.05, b2: 0.06, niacin: 0.51,
    }, [1, '份', 150], ['花椰菜', '菜花', '白花菜', '椰菜花']],
  ['圆白菜', '蔬菜', [25, 1.28, 0.1, 5.8],
    {
      fiber: 2.5, sodium: 18,
      potassium: 170, calcium: 40, iron: 0.47, zinc: 0.18, selenium: 0.3, magnesium: 12,
      va: 5, vc: 36.6, vd: 0, ve: 0.15, b1: 0.06, b2: 0.04, niacin: 0.23,
    }, [1, '份', 200], ['卷心菜', '包菜', '洋白菜', '甘蓝', '绿甘蓝', '圆白菜丝']],
  ['平菇', '蔬菜', [33, 3.31, 0.41, 6.09],
    {
      fiber: 2.3, sodium: 18,
      potassium: 420, calcium: 3, iron: 1.33, zinc: 0.77, selenium: 2.6, magnesium: 18,
      va: 2, vc: 0, vd: 0.7, b1: 0.13, b2: 0.35, niacin: 4.96,
    }, [1, '份', 150], ['侧耳', '平菇片', '鲜平菇']],
  ['金针菇', '蔬菜', [37, 2.66, 0.29, 7.81],
    {
      fiber: 2.7, sodium: 3,
      potassium: 359, iron: 1.15, zinc: 0.65, selenium: 2.2, magnesium: 16,
      vc: 0, vd: 0.1, ve: 0.01, b1: 0.23, b2: 0.2, niacin: 7.03,
    }, [1, '份', 150], ['金菇', '朴菇', '金针蘑']],
  ['海带', '蔬菜', [13, 1.2, 0.1, 2.1],
    {
      fiber: 0.5, sodium: 8.6,
      potassium: 246, calcium: 46, iron: 0.9, zinc: 0.16, selenium: 0.49, magnesium: 25,
      va: 0, vc: 0, vd: 0, ve: 0.85, b1: 0.02, b2: 0.15, niacin: 1.3,
    }, [1, '份', 100], ['海带丝', '海带结', '昆布', '鲜海带']],
  ['大蒜', '蔬菜', [149, 6.36, 0.5, 33.1],
    {
      fiber: 2.1, sodium: 17,
      potassium: 401, calcium: 181, iron: 1.7, zinc: 1.16, selenium: 14.2, magnesium: 25,
      va: 0, vc: 31.2, vd: 0, ve: 0.08, b1: 0.2, b2: 0.11, niacin: 0.7,
    }, [2, '瓣', 10], ['蒜瓣', '蒜头', '蒜米', '大蒜瓣']],
  ['生姜', '蔬菜', [46, 1.3, 0.6, 10.3],
    {
      fiber: 2.7, sodium: 14.9,
      potassium: 295, calcium: 27, iron: 1.4, zinc: 0.34, selenium: 0.56, magnesium: 44,
      va: 28, vc: 4, vd: 0, b1: 0.02, b2: 0.03, niacin: 0.6,
    }, [2, '片', 6], ['姜片', '老姜', '生姜片', '姜丝', '生姜末']],
  ['西瓜', '水果', [30, 0.61, 0.15, 7.55],
    {
      fiber: 0.4, sodium: 1,
      potassium: 112, calcium: 7, iron: 0.24, zinc: 0.1, selenium: 0.4, magnesium: 10,
      va: 28, vc: 8.1, vd: 0, ve: 0.05, b1: 0.03, b2: 0.02, niacin: 0.18,
    }, [1, '块', 300], ['西瓜瓤', '西瓜肉']],
  ['梨', '水果', [57, 0.36, 0.14, 15.2],
    {
      fiber: 3.1, sodium: 1,
      potassium: 116, calcium: 9, iron: 0.18, zinc: 0.1, selenium: 0.1, magnesium: 7,
      va: 1, vc: 4.3, vd: 0, ve: 0.12, b1: 0.01, b2: 0.03, niacin: 0.16,
    }, [1, '个', 150], ['雪梨', '鸭梨', '梨子']],
  ['葡萄', '水果', [69, 0.72, 0.16, 18.1],
    {
      fiber: 0.9, sodium: 2,
      potassium: 191, calcium: 10, iron: 0.36, zinc: 0.07, selenium: 0.1, magnesium: 7,
      va: 3, vc: 3.2, vd: 0, ve: 0.19, b1: 0.07, b2: 0.07, niacin: 0.19,
    }, [1, '个', 150], ['提子', '葡萄粒', '紫葡萄']],
  ['草莓', '水果', [32, 0.67, 0.3, 7.68],
    {
      fiber: 2, sodium: 1,
      potassium: 153, calcium: 16, iron: 0.41, zinc: 0.14, selenium: 0.4, magnesium: 13,
      va: 1, vc: 58.8, vd: 0, ve: 0.29, b1: 0.02, b2: 0.02, niacin: 0.39,
    }, [1, '个', 150], ['草莓果', '红颜草莓']],
  ['芒果', '水果', [60, 0.82, 0.38, 15],
    {
      fiber: 1.6, sodium: 1,
      potassium: 168, calcium: 11, iron: 0.16, zinc: 0.09, selenium: 0.6, magnesium: 10,
      va: 54, vc: 36.4, vd: 0, ve: 0.9, b1: 0.03, b2: 0.04, niacin: 0.67,
    }, [1, '个', 150], ['杧果', '芒果肉', '小台芒']],
  ['桃', '水果', [39, 0.91, 0.25, 9.54],
    {
      fiber: 1.5, sodium: 0,
      potassium: 190, calcium: 6, iron: 0.25, zinc: 0.17, selenium: 0.1, magnesium: 9,
      va: 16, vc: 6.6, vd: 0, ve: 0.73, b1: 0.02, b2: 0.03, niacin: 0.81,
    }, [1, '个', 150], ['桃子', '水蜜桃', '油桃']],
  ['菠萝', '水果', [50, 0.54, 0.12, 13.1],
    {
      fiber: 1.4, sodium: 1,
      potassium: 109, calcium: 13, iron: 0.29, zinc: 0.12, selenium: 0.1, magnesium: 12,
      va: 3, vc: 47.8, vd: 0, ve: 0.02, b1: 0.08, b2: 0.03, niacin: 0.5,
    }, [1, '个', 150], ['凤梨', '菠萝块']],
  ['柿子', '水果', [70, 0.58, 0.19, 18.6],
    {
      fiber: 3.6, sodium: 1,
      potassium: 161, calcium: 8, iron: 0.15, zinc: 0.11, selenium: 0.6, magnesium: 9,
      va: 81, vc: 7.5, vd: 0, ve: 0.73, b1: 0.03, b2: 0.02, niacin: 0.1,
    }, [1, '个', 150], ['脆柿', '柿子果']],
  ['樱桃', '水果', [63, 1.06, 0.2, 16],
    {
      fiber: 2.1, sodium: 0,
      potassium: 222, calcium: 13, iron: 0.36, zinc: 0.07, magnesium: 11,
      va: 3, vc: 7, vd: 0, ve: 0.07, b1: 0.03, b2: 0.03, niacin: 0.15,
    }, [1, '个', 150], ['车厘子', '大樱桃']],
  ['荔枝', '水果', [66, 0.83, 0.44, 16.5],
    {
      fiber: 1.3, sodium: 1,
      potassium: 171, calcium: 5, iron: 0.31, zinc: 0.07, selenium: 0.6, magnesium: 10,
      va: 0, vc: 71.5, vd: 0, ve: 0.07, b1: 0.01, b2: 0.07, niacin: 0.6,
    }, [1, '个', 150], ['妃子笑', '荔枝肉']],
  ['鲜枣', '水果', [79, 1.2, 0.2, 20.2],
    {
      sodium: 3,
      potassium: 250, calcium: 21, iron: 0.48, zinc: 0.05, magnesium: 10,
      va: 2, vc: 69, b1: 0.02, b2: 0.04, niacin: 0.9,
    }, [1, '个', 150], ['冬枣', '鲜枣子']],
  ['橘子', '水果', [53, 0.81, 0.31, 13.3],
    {
      fiber: 1.8, sodium: 2,
      potassium: 166, calcium: 37, iron: 0.15, zinc: 0.07, selenium: 0.1, magnesium: 12,
      va: 34, vc: 26.7, vd: 0, ve: 0.2, b1: 0.06, b2: 0.04, niacin: 0.38,
    }, [1, '个', 150], ['桔子', '砂糖橘', '蜜橘']],
  ['柚子', '水果', [38, 0.76, 0.04, 9.62],
    {
      fiber: 1, sodium: 1,
      potassium: 216, calcium: 4, iron: 0.11, zinc: 0.08, magnesium: 6,
      va: 0, vc: 61, b1: 0.03, b2: 0.03, niacin: 0.22,
    }, [1, '个', 150], ['蜜柚', '沙田柚', '文旦']],
  ['柠檬', '水果', [29, 1.1, 0.3, 9.32],
    {
      fiber: 2.8, sodium: 2,
      potassium: 138, calcium: 26, iron: 0.6, zinc: 0.06, selenium: 0.4, magnesium: 8,
      va: 1, vc: 53, vd: 0, ve: 0.15, b1: 0.04, b2: 0.02, niacin: 0.1,
    }, [1, '个', 100], ['柠檬果', '黄柠檬']],
  ['石榴', '水果', [83, 1.67, 1.17, 18.7],
    {
      fiber: 4, sodium: 3,
      potassium: 236, calcium: 10, iron: 0.3, zinc: 0.35, selenium: 0.5, magnesium: 12,
      va: 0, vc: 10.2, vd: 0, ve: 0.6, b1: 0.07, b2: 0.05, niacin: 0.29,
    }, [1, '个', 150], ['石榴籽', '软籽石榴']],
  ['牛油果', '水果', [160, 2, 14.7, 8.53],
    {
      fiber: 6.7, sodium: 7,
      potassium: 485, calcium: 12, iron: 0.55, zinc: 0.64, selenium: 0.4, magnesium: 29,
      va: 7, vc: 10, vd: 0, ve: 2.07, b1: 0.07, b2: 0.13, niacin: 1.74,
    }, [1, '个', 150], ['鳄梨', '油梨']],
  ['哈密瓜', '水果', [34, 0.84, 0.19, 8.16],
    {
      fiber: 0.9, sodium: 16,
      potassium: 267, calcium: 9, iron: 0.21, zinc: 0.18, selenium: 0.4, magnesium: 12,
      va: 169, vc: 36.7, vd: 0, ve: 0.05, b1: 0.04, b2: 0.02, niacin: 0.73,
    }, [1, '块', 200], ['甜瓜', '网纹瓜']],
  ['腰果', '坚果', [553, 18.2, 43.9, 30.2],
    {
      fiber: 3.3, sodium: 12,
      potassium: 660, calcium: 37, iron: 6.68, zinc: 5.78, selenium: 19.9, magnesium: 292,
      va: 0, vc: 0.5, vd: 0, ve: 0.9, b1: 0.42, b2: 0.06, niacin: 1.06,
    }, [1, '把', 20], ['腰果仁', '生腰果']],
  ['开心果', '坚果', [560, 20.2, 45.3, 27.2],
    {
      fiber: 10.6, sodium: 1,
      potassium: 1025, calcium: 105, iron: 3.92, zinc: 2.2, selenium: 7, magnesium: 121,
      va: 26, vc: 5.6, vd: 0, ve: 2.86, b1: 0.87, b2: 0.16, niacin: 1.3,
    }, [1, '把', 20], ['阿月浑子', '开心果仁']],
  ['榛子', '坚果', [628, 15, 60.8, 16.7],
    {
      fiber: 9.7, sodium: 0,
      potassium: 680, calcium: 114, iron: 4.7, zinc: 2.45, selenium: 2.4, magnesium: 163,
      va: 1, vc: 6.3, vd: 0, ve: 15, b1: 0.64, b2: 0.11, niacin: 1.8,
    }, [1, '把', 20], ['榛子仁', '平榛']],
  ['南瓜子', '坚果', [574, 29.8, 49.1, 14.7],
    {
      fiber: 6.5, sodium: 18,
      potassium: 788, calcium: 52, iron: 8.07, zinc: 7.64, selenium: 9.4, magnesium: 550,
      va: 0, vc: 1.8, vd: 0, ve: 0.56, b1: 0.07, b2: 0.15, niacin: 4.43,
    }, [1, '把', 20], ['南瓜子仁', '白瓜子']],
  ['葵花籽', '坚果', [584, 20.8, 51.5, 20],
    {
      fiber: 8.6, sodium: 9,
      potassium: 645, calcium: 78, iron: 5.25, zinc: 5, selenium: 53, magnesium: 325,
      va: 3, vc: 1.4, vd: 0, ve: 35.2, b1: 1.48, b2: 0.36, niacin: 8.34,
    }, [1, '把', 20], ['葵花子', '瓜子', '葵瓜子']],
  ['亚麻籽', '坚果', [534, 18.3, 42.2, 28.9],
    {
      fiber: 27.3, sodium: 30,
      potassium: 813, calcium: 255, iron: 5.73, zinc: 4.34, selenium: 25.4, magnesium: 392,
      va: 0, vc: 0.6, vd: 0, ve: 0.31, b1: 1.64, b2: 0.16, niacin: 3.08,
    }, [1, '把', 20], ['胡麻籽', '亚麻子']],
  ['奇亚籽', '坚果', [486, 16.5, 30.7, 42.1],
    {
      fiber: 34.4, sodium: 16,
      potassium: 407, calcium: 631, iron: 7.72, zinc: 4.58, selenium: 55.2, magnesium: 335,
      vc: 1.6, ve: 0.5, b1: 0.62, b2: 0.17, niacin: 8.83,
    }, [1, '把', 20], ['奇亚子', '鼠尾草籽']],
  ['板栗', '坚果', [224, 4.2, 1.11, 49.1],
    {
      sodium: 3,
      potassium: 447, calcium: 18, iron: 1.41, zinc: 0.87, magnesium: 84,
      va: 10, vc: 36, vd: 0, b1: 0.16, b2: 0.18, niacin: 0.8,
    }, [1, '把', 20], ['栗子', '毛栗', '板栗仁']],
  ['橄榄油', '油脂', [884, 0, 100, 0],
    {
      fiber: 0, sodium: 2,
      potassium: 1, calcium: 1, iron: 0.56, zinc: 0, selenium: 0, magnesium: 0,
      va: 0, vc: 0, vd: 0, ve: 14.4, b1: 0, b2: 0, niacin: 0,
    }, [1, '勺', 10], ['初榨橄榄油', '特级初榨橄榄油']],
  ['花生油', '油脂', [884, 0, 100, 0],
    {
      fiber: 0, sodium: 0,
      potassium: 0, calcium: 0, iron: 0.03, zinc: 0.01, selenium: 0, magnesium: 0,
      va: 0, vc: 0, vd: 0, ve: 15.7, b1: 0, b2: 0, niacin: 0,
    }, [1, '勺', 10], ['花生仁油', '生油']],
  ['芝麻油', '油脂', [884, 0, 100, 0],
    {
      fiber: 0, sodium: 0,
      potassium: 0, calcium: 0, iron: 0, zinc: 0, selenium: 0, magnesium: 0,
      va: 0, vc: 0, vd: 0, ve: 1.4, b1: 0, b2: 0, niacin: 0,
    }, [1, '勺', 10], ['香油', '麻油', '小磨香油']],
  ['黄油', '油脂', [717, 0.85, 81.1, 0.06],
    {
      fiber: 0, sodium: 11,
      potassium: 24, calcium: 24, iron: 0.02, zinc: 0.09, selenium: 1, magnesium: 2,
      va: 684, vc: 0, vd: 0, ve: 2.32, b1: 0.01, b2: 0.03, niacin: 0.04,
    }, [1, '勺', 10], ['动物黄油', '淡味黄油']],
  ['醋', '调味', [18, 0, 0, 0.04],
    {
      fiber: 0, sodium: 2,
      potassium: 2, calcium: 6, iron: 0.03, zinc: 0.01, selenium: 0.5, magnesium: 1,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0, b2: 0, niacin: 0,
    }, [1, '勺', 10], ['米醋', '陈醋', '香醋']],
  ['蚝油', '调味', [51, 1.35, 0.25, 10.9],
    {
      fiber: 0.3, sodium: 2733,
      potassium: 54, calcium: 32, iron: 0.18, zinc: 0.09, selenium: 4.4, magnesium: 4,
      va: 0, vc: 0.1, vd: 0, ve: 0, b1: 0.01, b2: 0.12, niacin: 1.47,
    }, [1, '勺', 10], ['牡蛎油', '蚝汁']],
  ['芝麻酱', '调味', [592, 17.4, 53, 21.5],
    {
      fiber: 4.7, sodium: 35,
      potassium: 459, calcium: 141, iron: 4.42, zinc: 4.62, selenium: 34.4, magnesium: 95,
      va: 3, vc: 4.2, vd: 0, b1: 1.59, b2: 0.12, niacin: 5.64,
    }, [1, '勺', 10], ['麻酱', '芝麻酱料']],
  ['番茄酱', '调味', [101, 1.04, 0.1, 27.4],
    {
      fiber: 0.3, sodium: 907,
      potassium: 281, calcium: 15, iron: 0.35, zinc: 0.17, selenium: 0.7, magnesium: 13,
      va: 26, vc: 4.1, vd: 0, ve: 1.46, b1: 0.01, b2: 0.17, niacin: 1.43,
    }, [1, '勺', 10], ['茄汁', '番茄沙司']],
  ['蜂蜜', '调味', [304, 0.3, 0, 82.4],
    {
      fiber: 0.2, sodium: 4,
      potassium: 52, calcium: 6, iron: 0.42, zinc: 0.22, selenium: 0.8, magnesium: 2,
      va: 0, vc: 0.5, vd: 0, ve: 0, b1: 0, b2: 0.04, niacin: 0.12,
    }, [1, '勺', 10], ['蜜糖', '土蜂蜜']],
  ['绿茶', '饮料', [1, 0.22, 0, 0],
    {
      fiber: 0, sodium: 1,
      potassium: 8, iron: 0.02, zinc: 0.01, magnesium: 1,
      va: 0, vc: 0, vd: 0, ve: 0, b1: 0.01, b2: 0.06, niacin: 0.03,
    }, [1, '杯', 250], ['茶水', '清茶', '绿茶水']],
  ['黑米', '主食', [341, 9.4, 2.5, 72.2],
    {
      fiber: 3.9, sodium: 7.1,
      potassium: 256, calcium: 12, iron: 1.6, zinc: 3.8, selenium: 3.2, magnesium: 147,
      va: 0, vc: 0, vd: 0, b1: 0.33, b2: 0.13,
    }, [1, '份', 50], ['黑大米', '紫米']],
  ['黑米粥', '主食', [43, 1.2, 0.3, 9],
    {
      fiber: 0.5, sodium: 1,
      potassium: 32, calcium: 1.5, iron: 0.2, zinc: 0.5, selenium: 0.4, magnesium: 18,
      va: 0, vc: 0, vd: 0, b1: 0.04, b2: 0.02,
    }, [1, '碗', 300], ['紫米粥', '黑米稀饭']],
  // ─── 扩展库结束 ───
];

function build(): SeedFood[] {
  return ROWS.map(([name, category, macro, more, serving, aliases], i) => {
    const [kcal, protein, fat, carbs] = macro;
    return {
      id: `preset_${String(i + 1).padStart(3, '0')}`,
      name,
      category,
      aliases: aliases ?? [],
      per100g: facts({ kcal, protein, fat, carbs, ...more }),
      serving: serving ? { quantity: serving[0], unit: serving[1], grams: serving[2] } : null,
    };
  });
}

export const SEED_FOODS: SeedFood[] = build();

/**
 * 种子库版本，变更时用于决定是否重新灌库。
 *
 * 定义已经搬到 ./seedVersion.ts —— 那个文件没有数据表，可以被首屏静态引用；
 * 这里 re-export 只为向后兼容（测试与工具从 './seed' 引，保持原路径不动）。
 * 新增引用请直接引 './seedVersion'，否则等于把 174 条数据重新拖回首屏。
 */
export { SEED_VERSION } from './seedVersion';

export const FOOD_CATEGORIES = ['主食', '蛋白', '蔬菜', '水果', '坚果', '油脂', '调味', '饮料', '家常菜'] as const;
