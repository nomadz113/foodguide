/**
 * 名称归一化与本地搜索。
 *
 * 只做「同一食物不同写法」的收敛（去空格、去括号、去标点、全角转半角），
 * 不做语义同义词——那是 AI 的活。
 */

/** 全角转半角 + 去空白 + 去括号内容 + 去连接符 + 小写 */
export function normalizeName(input: string): string {
  let s = input.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  s = s.replace(/\u3000/g, ' ');
  s = s.replace(/[（(][^）)]*[）)]/g, '');
  s = s.replace(/[\s·・\-—_、,，。.]+/g, '');
  return s.trim().toLowerCase();
}

export interface Searchable {
  name: string;
  aliases: string[];
  category: string;
  usageCount?: number;
}

/**
 * 本地搜索打分：0 表示不匹配。
 * 命中位置越靠前、覆盖率越高分越高；历史使用次数作为微弱加权。
 */
export function searchScore(query: string, food: Searchable): number {
  const q = normalizeName(query);
  if (!q) return 0;

  const names = [food.name, ...food.aliases];
  let best = 0;
  for (const raw of names) {
    const n = normalizeName(raw);
    if (!n) continue;
    if (n === q) best = Math.max(best, 1);
    else if (n.startsWith(q)) best = Math.max(best, 0.9);
    else if (n.includes(q)) best = Math.max(best, 0.7 + 0.2 * (q.length / n.length));
  }
  if (best === 0) return 0;

  // 历史使用次数最多加 6%，只做同分时的排序修正
  const usage = Math.min(food.usageCount ?? 0, 20) * 0.003;
  return Math.min(1, best + usage);
}

export function searchFoods<T extends Searchable>(query: string, list: T[], limit = 12): T[] {
  if (!query.trim()) return [];
  return list
    .map((f) => ({ f, s: searchScore(query, f) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.f);
}
