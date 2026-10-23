/**
 * 意图 → 可确认的卡片。纯函数，不碰数据库，可被 vitest 直接测。
 *
 * 这一层的职责是把"模型说的话"变成"确定会发生什么"：
 * - 基准换算（per_serving → per100g）在这一层完成，出错就是系统性 2.5 倍偏差
 * - 每一项营养值的来源在这一层标定（custom / preset / ai），用户点保存前要看得见
 * - 任何算不出来、只能编的地方，一律写进 caveats，不静默兜底
 */

import { MICRO_KEYS, NUTRIENT_LABELS, isKnown, emptyFacts, type NutritionFacts } from '../nutrition/types';
import { scaleFacts } from '../nutrition/calc';
import { findMatch } from '../food/match';
import { guessSlot, parseDayKey } from '../date';
import type { Food, MealSlot } from '../db/types';
import type { Intent } from '../ai/intent';
import { toFacts } from '../ai/intent';

export type CardKind = 'create_food' | 'update_food' | 'delete_food' | 'log_meal' | 'text';

export interface FoodCard {
  kind: 'create_food' | 'update_food' | 'delete_food';
  name: string;
  aliases: string[];
  category: string;
  /** 用户口径的那一份；per_100g 且没说份量时为 null */
  serving: { quantity: number; unit: string; grams: number } | null;
  basis: 'per_serving' | 'per_100g';
  /**
   * 用户口径的营养值 —— 编辑时改的是这一份，`per100g` 由它派生。
   * per_serving 时是"这一碗"的值；per_100g 时就是每百克的值。
   */
  servingValues: NutritionFacts;
  /** 派生：库里统一存每 100g */
  per100g: NutritionFacts;
  /** 用户描述的那一份是多少 kcal（比如"一碗 320 大卡"里的 320） */
  servingKcal: number | null;
  /** update / delete 命中的已有条目 */
  existingId: string | null;
  existingSource: 'custom' | 'preset' | null;
  assumptions: string[];
  missing: string[];
  caveats: string[];
  confidence: number;
}

export type ItemSource = 'custom' | 'preset' | 'ai';

export interface MealCardItem {
  name: string;
  grams: number;
  per100g: NutritionFacts;
  nutrition: NutritionFacts;
  kcal: number;
  source: ItemSource;
  foodId: string | null;
  matchScore: number | null;
}

export interface MealCard {
  kind: 'log_meal';
  slot: MealSlot;
  date: string;
  items: MealCardItem[];
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  assumptions: string[];
  missing: string[];
  caveats: string[];
  confidence: number;
}

export interface TextCard {
  kind: 'text';
  reply: string;
  /** query_stats / query_food 需要页面去查本地数据 */
  query: 'stats' | 'food' | null;
  queryName: string | null;
}

export type ResolvedCard = FoodCard | MealCard | TextCard;

export interface ResolveContext {
  foods: Food[];
  /** 今天（按切日设置），用于"今天/刚才"落位 */
  today: string;
  now?: Date;
}

const SOURCE_LABEL: Record<ItemSource, string> = {
  custom: '你的库',
  preset: '食物库',
  ai: 'AI 估算',
};

export function sourceLabel(s: ItemSource): string {
  return SOURCE_LABEL[s];
}

/** 把 intent 里的中文名 missing 保持在展示口径上 */
function missingFromFacts(f: NutritionFacts): string[] {
  return MICRO_KEYS.filter((k) => !isKnown(f[k])).map((k) => NUTRIENT_LABELS[k]);
}

/** 日期字符串合法性：严格 YYYY-MM-DD，且距今天不超过一年（防模型写 2024-13-45） */
function safeDate(input: string | null, today: string): string | null {
  if (!input) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const d = parseDayKey(input);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.abs(d.getTime() - parseDayKey(today).getTime());
  if (diff > 366 * 86_400_000) return null;
  return input;
}

/**
 * 由「用户口径的营养值」派生每百克。
 * 这是全项目第二处缩放公式（第一处是 scaleFacts），方向相反：
 * scaleFacts 是 per100g → 绝对量，这里是 一份 → per100g。
 */
export function derivePer100g(
  values: NutritionFacts,
  basis: 'per_serving' | 'per_100g',
  grams: number | null,
): NutritionFacts {
  if (basis === 'per_100g' || !grams || grams <= 0) return { ...values };
  const factor = 100 / grams;
  const out = {} as NutritionFacts;
  for (const k of Object.keys(values) as (keyof NutritionFacts)[]) {
    const v = values[k];
    out[k] = isKnown(v) ? v * factor : null;
  }
  return out;
}

/** 改「一份多少克」：营养值不变，per100g 跟着变 */
export function withServingGrams(card: FoodCard, grams: number): FoodCard {
  const g = Math.max(1, Math.round(grams));
  const serving = card.serving
    ? { ...card.serving, grams: g }
    : { quantity: 1, unit: '份', grams: g };
  const per100g = derivePer100g(card.servingValues, card.basis, g);
  return {
    ...card,
    serving,
    per100g,
    servingKcal: card.basis === 'per_serving'
      ? (isKnown(card.servingValues.kcal) ? card.servingValues.kcal : null)
      : (isKnown(card.servingValues.kcal) ? (card.servingValues.kcal * g) / 100 : null),
  };
}

/** 改「一份的某项营养值」：只用有限数覆盖，空字符串表示删掉（保留 null） */
export function withServingValue(card: FoodCard, key: keyof NutritionFacts, value: number | null): FoodCard {
  const servingValues = { ...card.servingValues, [key]: value };
  const grams = card.serving?.grams ?? null;
  const per100g = derivePer100g(servingValues, card.basis, grams);
  const servingKcal = card.basis === 'per_serving'
    ? (isKnown(servingValues.kcal) ? servingValues.kcal : null)
    : (grams && isKnown(servingValues.kcal) ? (servingValues.kcal * grams) / 100 : null);
  return { ...card, servingValues, per100g, servingKcal };
}

/** 改某一条的克数：per100g 不动，绝对量重算 */
export function withItemGrams(card: MealCard, index: number, grams: number): MealCard {
  const items = card.items.map((it, i) => {
    if (i !== index) return it;
    const g = Math.max(1, Math.round(grams));
    const nutrition = scaleFacts(it.per100g, g);
    return { ...it, grams: g, nutrition, kcal: nutrition.kcal ?? 0 };
  });
  const sum = (k: keyof NutritionFacts) => items.reduce((a, it) => a + (it.nutrition[k] ?? 0), 0);
  return { ...card, items, kcal: sum('kcal'), protein: sum('protein'), fat: sum('fat'), carbs: sum('carbs') };
}

function resolveFood(intent: Intent, ctx: ResolveContext): ResolvedCard {
  // 删除走单独一条路：它不需要营养值，载荷在 target 而不是 food
  if (intent.type === 'delete_food') {
    const name = intent.target?.name ?? intent.food?.name ?? '';
    if (!name) return { kind: 'text', reply: '要删哪一条？', query: null, queryName: null };
    const hit = findMatch(name, ctx.foods);
    if (!hit) {
      return { kind: 'text', reply: `食物库里没找到「${name}」。`, query: 'food', queryName: name };
    }
    // 内置条目删不得：删了之后同名识别会退回到 AI 估算，等于凭空变差
    if (hit.food.source !== 'custom') {
      return {
        kind: 'text',
        reply: `「${hit.food.name}」是内置食物，删不掉。你自己加的那些才能删。`,
        query: null,
        queryName: null,
      };
    }
    return {
      kind: 'delete_food',
      name: hit.food.name,
      aliases: [],
      category: hit.food.category,
      serving: null,
      basis: 'per_serving',
      servingValues: emptyFacts(),
      per100g: emptyFacts(),
      servingKcal: null,
      existingId: hit.food.id,
      existingSource: 'custom',
      assumptions: [],
      missing: [],
      caveats: [],
      confidence: intent.confidence,
    };
  }

  const p = intent.food;
  if (!p) return { kind: 'text', reply: '我没听清这道菜是多重，能再说一遍吗？', query: null, queryName: null };

  const values = toFacts(p.values);
  const caveats = [...intent.caveats];
  const assumptions = [...intent.assumptions];

  let serving = p.serving;
  let servingKcal: number | null = null;
  let per100g: NutritionFacts;

  if (p.nutritionBasis === 'per_100g') {
    per100g = derivePer100g(values, 'per_100g', null);
    if (serving && serving.grams > 0 && isKnown(values.kcal)) {
      servingKcal = (values.kcal * serving.grams) / 100;
    }
  } else {
    // per_serving：没有克数就没法换算成 per100g。这时不许猜，直接拦下来。
    if (!serving || !Number.isFinite(serving.grams) || serving.grams <= 0) {
      return {
        kind: 'text',
        reply: '这一份大概多重？比如「一碗大概 250 克」。有了克数我才能换算成每百克。',
        query: null,
        queryName: null,
      };
    }
    per100g = derivePer100g(values, 'per_serving', serving.grams);
    servingKcal = isKnown(values.kcal) ? values.kcal : null;
    assumptions.push(`「${serving.quantity} ${serving.unit}」按 ${serving.grams}g 估算`);
  }

  if (!isKnown(per100g.kcal)) {
    return {
      kind: 'text',
      reply: '这句话里没有热量，我记下来也用不上。说个大概的热量就行，比如「一碗 320 大卡」。',
      query: null,
      queryName: null,
    };
  }

  // 已经存在同名自定义条目 -> 明确告诉用户是覆盖，不是新建
  // update_food 要按**旧名字**去找，否则改名场景会新建一条、旧的留在库里变重复
  const lookupName = intent.type === 'update_food' && intent.target?.name ? intent.target.name : p.name;
  const hit = findMatch(lookupName, ctx.foods);
  const existing = hit?.food ?? null;
  const existingSource = existing ? (existing.source === 'custom' ? 'custom' : 'preset') : null;
  if (existing) {
    caveats.push(
      existingSource === 'custom'
        ? (existing.name === p.name
          ? `会覆盖你已有的「${existing.name}」（同名条目只保留一条）`
          : `会把「${existing.name}」改名成「${p.name}」，不会多出一条`)
        : `会和内置的「${existing.name}」并存，之后匹配优先用你的（自定义优先级更高）`,
    );
  }

  const missing = intent.missing.length > 0 ? intent.missing : missingFromFacts(per100g);

  return {
    kind: intent.type === 'update_food' ? 'update_food' : 'create_food',
    name: p.name,
    aliases: p.aliases,
    category: p.category,
    serving,
    basis: p.nutritionBasis,
    servingValues: values,
    per100g,
    servingKcal,
    existingId: existing?.id ?? null,
    existingSource,
    assumptions,
    missing,
    caveats,
    confidence: intent.confidence,
  };
}

function resolveMeal(intent: Intent, ctx: ResolveContext): ResolvedCard {
  const m = intent.meal;
  if (!m || m.items.length === 0) {
    return { kind: 'text', reply: '这顿吃了什么？说一下菜名和大概份量就行。', query: null, queryName: null };
  }

  const caveats = [...intent.caveats];
  const items: MealCardItem[] = [];

  for (const it of m.items) {
    const grams = Math.max(1, Math.round(it.grams));
    const hit = findMatch(it.name, ctx.foods);

    if (hit) {
      // 库里有：用库值（预置是整理过的，自定义是用户自己的事实），丢掉 AI 的估算
      const source: ItemSource = hit.food.source === 'custom' ? 'custom' : 'preset';
      const nutrition = scaleFacts(hit.food.per100g, grams);
      items.push({
        name: it.name,
        grams,
        per100g: hit.food.per100g,
        nutrition,
        kcal: nutrition.kcal ?? 0,
        source,
        foodId: hit.food.id,
        matchScore: hit.score,
      });
      continue;
    }

    const aiFacts = toFacts(it.per100g);
    if (!isKnown(aiFacts.kcal)) {
      caveats.push(`「${it.name}」既不在食物库里、AI 也没给出热量，这一项没有记`);
      continue;
    }
    const nutrition = scaleFacts(aiFacts, grams);
    items.push({
      name: it.name,
      grams,
      per100g: aiFacts,
      nutrition,
      kcal: nutrition.kcal ?? 0,
      source: 'ai',
      foodId: null,
      matchScore: null,
    });
  }

  if (items.length === 0) {
    return { kind: 'text', reply: '这些我都没算出营养值，换成食物库里有的说法再试试？', query: null, queryName: null };
  }

  const sum = (k: keyof NutritionFacts) =>
    items.reduce((a, it) => a + (it.nutrition[k] ?? 0), 0);

  const slot: MealSlot = m.slot ?? guessSlot(ctx.now ?? new Date());
  const date = safeDate(m.date, ctx.today) ?? ctx.today;
  if (m.date && safeDate(m.date, ctx.today) === null) {
    caveats.push(`日期「${m.date}」看不懂，按今天记`);
  }

  // 全部项都没热量的营养素，在卡片上提示"这些没算"
  const totalAll: NutritionFacts = {} as NutritionFacts;
  for (const k of Object.keys(items[0]!.nutrition) as (keyof NutritionFacts)[]) {
    totalAll[k] = items.some((it) => isKnown(it.nutrition[k])) ? sum(k) : null;
  }

  return {
    kind: 'log_meal',
    slot,
    date,
    items,
    kcal: sum('kcal'),
    protein: sum('protein'),
    fat: sum('fat'),
    carbs: sum('carbs'),
    assumptions: intent.assumptions,
    missing: missingFromFacts(totalAll),
    caveats,
    confidence: intent.confidence,
  };
}

export function resolveIntent(intent: Intent, ctx: ResolveContext): ResolvedCard {
  switch (intent.type) {
    case 'create_food':
    case 'update_food':
    case 'delete_food':
      return resolveFood(intent, ctx);
    case 'log_meal':
    case 'update_meal':
      return resolveMeal(intent, ctx);
    case 'delete_meal':
      return {
        kind: 'text',
        reply: '删除某一餐还得去今日页手点，先把那餐找出来删掉更稳。',
        query: null,
        queryName: null,
      };
    case 'update_goal':
      return {
        kind: 'text',
        reply: '目标得改档案页，那儿的数字都是公式算的，不能一句话改。',
        query: null,
        queryName: null,
      };
    case 'query_stats':
      return { kind: 'text', reply: intent.reply || '我看看今天的数。', query: 'stats', queryName: null };
    case 'query_food': {
      const name = intent.target?.name ?? intent.food?.name ?? '';
      return {
        kind: 'text',
        reply: intent.reply || (name ? `查一下「${name}」。` : '要查哪样？'),
        query: name ? 'food' : null,
        queryName: name || null,
      };
    }
    case 'clarify':
    case 'smalltalk':
    case 'unknown':
    default:
      return {
        kind: 'text',
        reply: intent.reply || '这句我没太理解，换个说法？',
        query: null,
        queryName: null,
      };
  }
}
