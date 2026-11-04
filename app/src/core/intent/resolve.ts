/**
 * 意图 → 可确认的卡片。纯函数，不碰数据库，可被 vitest 直接测。
 *
 * 这一层的职责是把"模型说的话"变成"确定会发生什么"：
 * - 基准换算（per_serving → per100g）在这一层完成，出错就是系统性 2.5 倍偏差
 * - 每一项营养值的来源在这一层标定（custom / preset / ai），用户点保存前要看得见
 * - 任何算不出来、只能编的地方，一律写进 caveats，不静默兜底
 */

import { MICRO_KEYS, NUTRIENT_LABELS, isKnown, emptyFacts, type NutrientKey, type NutritionFacts } from '../nutrition/types';
import { scaleFacts } from '../nutrition/calc';
import { findMatch, findSuffixMatch, fillMicro } from '../food/match';
import { roundGrams } from '../meal/grams';
import { eatenGrams, nearestShareTier, shareFactor, SHARE_LABELS, type ShareTier } from '../meal/share';
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
  /** AI 给的基准份（= 首次解析时的 grams）。咸淡三档以它为锚，避免连点累乘 */
  baseG?: number;
  per100g: NutritionFacts;
  nutrition: NutritionFacts;
  kcal: number;
  source: ItemSource;
  foodId: string | null;
  matchScore: number | null;
  /** 微量取自哪条库食物；null 表示没补（宏量始终是这个 item 自己的） */
  microFrom?: string | null;
  /** 实际被库填上的字段，用于逐字段标来源；空数组 = 库没帮上忙 */
  filled?: NutrientKey[];
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
  /** 合餐折算过的档位；null = 没折算（整份就是用户吃的）。只用于展示与切换 */
  share?: ShareTier | null;
  /**
   * 折算前的整份快照，只在 share 三档之间来回切时用（反复乘会越来越小）。
   * 不参与展示、不参与入库 —— apply 只读 items。
   */
  wholeItems?: MealCardItem[];
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

/**
 * 来源标签一律两字以内。
 *
 * 不是为了好看：`.src` 抬到 12px 之后每个字的盒宽是 12px，「你的库」是 36px、
 * 「AI 估算」是 60px，而这一行旁边就是菜名（`.ic-item-l b`，12.5px + ellipsis）。
 * 三段来源宽度不同 → 同一列表里两条的菜名起点错开；宽度太大会把长菜名挤成省略号。
 * 收到两字之后四类来源（含「库补」）全部同宽，菜名可用宽回到 163.5px。
 */
const SOURCE_LABEL: Record<ItemSource, string> = {
  custom: '自建',
  preset: '库',
  ai: 'AI',
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
  const g = roundGrams(grams);
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
    const g = roundGrams(grams);
    const nutrition = scaleFacts(it.per100g, g);
    return { ...it, grams: g, nutrition, kcal: nutrition.kcal ?? 0 };
  });
  const sum = (k: keyof NutritionFacts) => items.reduce((a, it) => a + (it.nutrition[k] ?? 0), 0);
  return { ...card, items, kcal: sum('kcal'), protein: sum('protein'), fat: sum('fat'), carbs: sum('carbs') };
}

/**
 * 「我吃了多少」三档：从整份快照重算全部条目，不做增量乘法。
 *
 * 为什么不乘当前值：点了「一半」再点「三分之一」时，若在已缩小的克数上再乘，
 * 会得到 1/6 —— 用户永远回不到原来的整份。所以必须锚在 wholeItems 上。
 */
export function withShare(card: MealCard, tier: ShareTier): MealCard {
  const whole = card.wholeItems ?? card.items;
  const f = shareFactor(tier);
  const items = whole.map((it) => {
    const g = eatenGrams(it.grams, f);
    const nutrition = scaleFacts(it.per100g, g);
    return { ...it, grams: g, baseG: g, nutrition, kcal: nutrition.kcal ?? 0 };
  });
  const sum = (k: keyof NutritionFacts) => items.reduce((a, it) => a + (it.nutrition[k] ?? 0), 0);
  const newCaveat = `已按「吃了${SHARE_LABELS[tier]}」折算：上面的克数是你要吃的部分，不是锅里的整份`;
  return {
    ...card,
    items,
    wholeItems: whole,
    share: tier,
    caveats: [...card.caveats.filter((c) => !c.startsWith('已按「吃了')), ...(tier === 'all' ? [] : [newCaveat])],
    kcal: sum('kcal'),
    protein: sum('protein'),
    fat: sum('fat'),
    carbs: sum('carbs'),
  };
}

/** 推断当前落在那档（用于按钮高亮）；没折算过就是 all */
export function inferShare(card: MealCard): ShareTier {
  return card.share ?? 'all';
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
    // 不取整：盐、油、糖的整份常常只有零点几克，round 成 1g 就是 +150% 的钠
    const grams = roundGrams(it.grams);
    const aiFacts = toFacts(it.per100g);
    const hit = findMatch(it.name, ctx.foods);

    // 只有两种情况整条用库值，其余一律「AI 定宏量、库定微量」（口径与拍照/AddMeal 对齐）：
    // ① 用户自建条目 —— 那是用户自己录的事实，比模型对同类食物的通用估值可信；
    // ② AI 没给热量 —— 库是唯一的数据源，不整条用就没有数。
    if (hit && (hit.food.source === 'custom' || !isKnown(aiFacts.kcal))) {
      const nutrition = scaleFacts(hit.food.per100g, grams);
      items.push({
        name: it.name,
        grams,
        baseG: grams,
        per100g: hit.food.per100g,
        nutrition,
        kcal: nutrition.kcal ?? 0,
        source: hit.food.source === 'custom' ? 'custom' : 'preset',
        foodId: hit.food.id,
        matchScore: hit.score,
      });
      continue;
    }

    if (!isKnown(aiFacts.kcal)) {
      caveats.push(`「${it.name}」既不在食物库里、AI 也没给出热量，这一项没有记`);
      continue;
    }

    // 命中与尾锚定走同一条路：库里那条是「这种食材」的标准值（生重），
    // AI 给的是「这盘菜」的入口状态。整条换库值会把无油煎熟制的 165 kcal
    // 换成生鸡胸肉的 133 kcal —— 微量回来了，宏量反而错了。所以宏量留 AI，微量借库。
    const ref = hit ?? findSuffixMatch(it.name, ctx.foods);
    const fill = fillMicro(aiFacts, ref?.food ?? null, ref?.score ?? 0);
    // 命中时名字本来就对得上，不必解释；尾锚定是「名字对不上但确实是这个食材」，要说一句
    if (!hit && ref && fill.filled.length > 0) {
      caveats.push(
        `「${it.name}」的热量与宏量按 AI 估的这盘菜算，${fill.filled.length} 项微量参考食物库「${ref.food.name}」`,
      );
    }
    const nutrition = scaleFacts(fill.per100g, grams);
    items.push({
      name: it.name,
      grams,
      baseG: grams,
      per100g: fill.per100g,
      nutrition,
      kcal: nutrition.kcal ?? 0,
      source: 'ai',
      foodId: ref?.food.id ?? null,
      matchScore: ref?.score ?? null,
      microFrom: fill.source,
      filled: fill.filled,
    });
  }

  if (items.length === 0) {
    return { kind: 'text', reply: '这些我都没算出营养值，换成食物库里有的说法再试试？', query: null, queryName: null };
  }

  // 合餐折算：模型只给「吃了几成」，乘法只在这一处做 —— 一处算、一处可测、一处可回退。
  // 先留一份整份快照，卡片上的三档才能在它们之间来回切而不漂移（反复乘会越来越小）。
  const share = nearestShareTier(m.share);
  const wholeItems = items;
  const shown = share
    ? items.map((it) => {
        const g = eatenGrams(it.grams, shareFactor(share));
        const nutrition = scaleFacts(it.per100g, g);
        // baseG 也跟着落到「吃到的那份」：咸淡三档是按你实际吃到的咸度调的，
        // 锚在锅里那份会让 1/3 折算后再点「咸」直接跳到整份的量级
        return { ...it, grams: g, baseG: g, nutrition, kcal: nutrition.kcal ?? 0 };
      })
    : items;

  const sum = (k: keyof NutritionFacts) =>
    shown.reduce((a, it) => a + (it.nutrition[k] ?? 0), 0);

  const slot: MealSlot = m.slot ?? guessSlot(ctx.now ?? new Date());
  const date = safeDate(m.date, ctx.today) ?? ctx.today;
  if (m.date && safeDate(m.date, ctx.today) === null) {
    caveats.push(`日期「${m.date}」看不懂，按今天记`);
  }

  // 全部项都没热量的营养素，在卡片上提示"这些没算"
  const totalAll: NutritionFacts = {} as NutritionFacts;
  for (const k of Object.keys(shown[0]!.nutrition) as (keyof NutritionFacts)[]) {
    totalAll[k] = shown.some((it) => isKnown(it.nutrition[k])) ? sum(k) : null;
  }

  if (share) {
    caveats.push(`已按「吃了${SHARE_LABELS[share]}」折算：上面的克数是你要吃的部分，不是锅里的整份`);
  }

  return {
    kind: 'log_meal',
    slot,
    date,
    items: shown,
    wholeItems: share ? wholeItems : undefined,
    kcal: sum('kcal'),
    protein: sum('protein'),
    fat: sum('fat'),
    carbs: sum('carbs'),
    assumptions: intent.assumptions,
    missing: missingFromFacts(totalAll),
    caveats,
    share,
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
