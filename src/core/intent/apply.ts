/**
 * 卡片 → 真正写库。
 *
 * 这里是全 App 唯一由自然语言触发的写入口，所以只有一条铁律：
 * **必须已经被用户点过一次保存**。调用方在点「保存」的回调里才会进来，
 * 解析完直接调这个函数是错的（见 §6.3）。
 *
 * 第二个纪律：一条错的自定义食物会污染未来所有识别（custom 优先级最高），
 * 所以这里的每个数字都来自用户确认过的卡片，不做任何"顺手优化"。
 */

import { upsertFood, saveMeal, softDeleteFood, bumpFoodUsage } from '../db/repo';
import { makeItem, makeMeal, SLOT_LABELS } from '../meal/build';
import type { MealItem, MealSlot, MatchType } from '../db/types';
import type { MealCard, ResolvedCard } from './resolve';

export interface ApplyResult {
  ok: boolean;
  /** 气泡回执 */
  message: string;
  relatedFoodId: string | null;
  relatedMealId: string | null;
}

const r1 = (n: number) => Math.round(n);

function matchTypeOf(source: 'custom' | 'preset' | 'ai'): MatchType {
  if (source === 'custom') return 'custom';
  if (source === 'preset') return 'library';
  return 'ai';
}

function buildMealItems(card: MealCard): MealItem[] {
  return card.items.map((it) =>
    makeItem(
      {
        name: it.name,
        per100g: it.per100g,
        baseG: it.grams,
        grams: it.grams,
        foodId: it.foodId,
        matchType: matchTypeOf(it.source),
        matchScore: it.matchScore,
        gramSource: it.source === 'ai' ? 'ai' : 'library',
        fieldSource: Object.fromEntries(
          Object.entries(it.per100g)
            .filter(([, v]) => v != null)
            .map(([k]) => [k, it.source === 'ai' ? 'ai' : 'library']),
        ) as MealItem['fieldSource'],
        confidence: 0.9,
      },
      'medium',
    ),
  );
}

export async function applyCard(card: ResolvedCard): Promise<ApplyResult> {
  if (card.kind === 'text') {
    return { ok: false, message: '这张卡不需要保存', relatedFoodId: null, relatedMealId: null };
  }

  if (card.kind === 'delete_food') {
    if (!card.existingId) {
      return { ok: false, message: `食物库里没找到「${card.name}」`, relatedFoodId: null, relatedMealId: null };
    }
    await softDeleteFood(card.existingId);
    return { ok: true, message: `删掉了「${card.name}」。历史记录不受影响。`, relatedFoodId: card.existingId, relatedMealId: null };
  }

  if (card.kind === 'create_food' || card.kind === 'update_food') {
    const food = await upsertFood(
      {
        name: card.name,
        per100g: card.per100g,
        aliases: card.aliases,
        category: card.category,
        serving: card.serving,
        source: 'custom',
      },
      // 只有命中的是自建条目才按 id 覆盖（改名场景靠它）；
      // 命中内置条目时传 null，让 upsert 走新建，绝不改内置数据
      card.existingSource === 'custom' ? card.existingId : null,
    );
    const kcal = card.servingKcal != null
      ? `${card.serving?.quantity ?? 1}${card.serving?.unit ?? '份'} ${r1(card.servingKcal)} 大卡`
      : `${r1(card.per100g.kcal ?? 0)} 大卡/100g`;
    return {
      ok: true,
      message: `已存进你的食物库：${card.name}，${kcal}。以后拍照或说「${card.name}」都优先用它。`,
      relatedFoodId: food.id,
      relatedMealId: null,
    };
  }

  if (card.kind !== 'log_meal') {
    return { ok: false, message: '这张卡不需要保存', relatedFoodId: null, relatedMealId: null };
  }

  // log_meal
  const items = buildMealItems(card);
  const meal = makeMeal({
    items,
    slot: card.slot as MealSlot,
    source: 'manual',
    date: card.date,
  });
  await saveMeal(meal);

  // 命中库条目的顺手累计使用次数，让搜索排序慢慢贴合个人习惯
  for (const it of card.items) {
    if (it.foodId) await bumpFoodUsage(it.foodId);
  }

  const names = card.items
    .map((it) => `${it.name} ${it.grams}g`)
    .join(' + ');
  return {
    ok: true,
    message: `已记入${SLOT_LABELS[card.slot]}：${names}，共 ${r1(card.kcal)} kcal。`,
    relatedFoodId: null,
    relatedMealId: meal.id,
  };
}
