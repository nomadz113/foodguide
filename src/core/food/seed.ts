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
    }, [1, '个', 100], ['白馒头', '馍']],
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
    }, [1, '块', 120], ['鸡胸', '鸡脯肉']],
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
    }, [1, '份', 120], ['瘦牛肉', '牛腱']],
  ['五花肉', '蛋白', [568, 7.7, 59, 0],
    {
      fiber: 0, sodium: 56,
      potassium: 188, calcium: 6, iron: 0.9, zinc: 1.2, selenium: 6, magnesium: 12,
      va: 10, vc: 0, vd: 0.3, ve: 0.3, b1: 0.3, b2: 0.1, niacin: 2.6,
    }, [1, '份', 80]],
  ['鲈鱼', '蛋白', [105, 18.6, 3.4, 0],
    {
      fiber: 0, sodium: 144,
      potassium: 205, calcium: 138, iron: 2, zinc: 2.8, selenium: 33, magnesium: 37,
      va: 19, vc: 0, vd: 4.6, ve: 0.8, b1: 0.03, b2: 0.17, niacin: 3.1,
    }, [1, '条', 250], ['鱼', '清蒸鱼']],
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
    }, [1, '份', 100]],
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
    }, [1, '个', 200], ['橙', '脐橙']],
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
    }, [1, '勺', 8], ['糖', '绵白糖']],
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
    }, [1, '小勺', 5], ['盐', '精盐']],

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
    }, [1, '碗', 250], ['河粉', '米线', '粉', '宽粉', '长沙米粉', '桂林米粉']],
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
    }, [1, '份', 100], ['生蚝', '海蛎子', '蚝']],
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
    }, [1, '个', 120], ['鸡腿', '去骨鸡腿', '鸡腿排', '琵琶腿', '炸鸡腿']],
  ['小葱', '蔬菜', [27, 1.7, 0.3, 5.4],
    {
      // 单次用量 5g 上下，热量可忽略，但它是汤面/炒菜里出现频率最高的配菜之一，
      // 缺这一条会让每碗面都少一项微矿覆盖
      fiber: 1.3, sodium: 10.4,
      potassium: 143, calcium: 72, iron: 1.3, zinc: 0.35, selenium: 0.6, magnesium: 18,
      va: 42, vc: 22, vd: 0, ve: 0.3, b1: 0.03, b2: 0.05, niacin: 0.4,
    }, [1, '把', 5], ['葱', '葱花', '香葱', '大葱']],
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

/** 种子库版本，变更时用于决定是否重新灌库 */
export const SEED_VERSION = 6;

export const FOOD_CATEGORIES = ['主食', '蛋白', '蔬菜', '水果', '坚果', '油脂', '调味', '饮料', '家常菜'] as const;
