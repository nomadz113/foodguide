/**
 * 每日建议：AI 只做叙述，数字全部由公式算好再喂进来。
 *
 * 为什么不让模型自己算：它会把 1902 − 1478 算错，还会编造「你今天缺 320mg 钙」。
 * 所以这里的分工是死规矩 —— 缺口、达标、盐量都是前端算好的输入，
 * 模型的任务只有两件：**排序**（这么多问题先解决哪个）和**说人话**（怎么吃才做得到）。
 */

export interface AdviceMealBrief {
  slot: string;
  kcal: number;
  items: string[];
}

export interface AdvicePayload {
  goalType: 'lose' | 'maintain' | 'gain' | 'health';
  /** 现在几点，决定说法的紧迫程度（早上不必催「今天吃多了」） */
  hour: number;

  kcalTarget: number;
  kcalIntake: number;
  /** 还可摄入，负数=已超 */
  remain: number;

  proteinTarget: number;
  proteinIntake: number;
  proteinGap: number;

  fiberTarget: number;
  fiberIntake: number;
  fiberGap: number;

  /** 钠折算的盐克数，null 表示钠数据不足 */
  saltG: number | null;
  saltLimitG: number;

  meals: AdviceMealBrief[];

  /**
   * 数据本身的缺口，由前端算出。
   * 不给这个字段，模型就会自己编「钠只有部分餐次有数据」——
   * 它不知道哪些项没数据，只能靠猜。
   */
  dataNotes: string[];

  /**
   * 已经算好克数的可执行动作（advice/actions.ts）。
   * 模型只能从这里挑选并改写措辞，不能自己发明数字 ——
   * 实测发现光靠「不要自己算」这句提示是拦不住的。
   */
  suggestedActions: string[];

  weightKg: number | null;
  targetWeightKg: number | null;
  /** 按当前节奏预计达成天数，null=无法预估 */
  projectedDays: number | null;
}

export const ADVICE_SYSTEM_PROMPT = `你是一位务实的营养师，正在给一位中国用户做当日复盘。用户已经用 App 记录了自己吃的每一样东西。

## 你的唯一职责
数字已经由程序算好了（见用户消息里的 JSON）。你**不计算、不改写、不新增任何数字**。
你只做两件事：
1. 排序：这么多差距里，今天最该管的是哪一件。
2. 说人话：怎么用具体的食物把这个差距补上。

## 硬性规则
- **只许使用 payload 里出现过的数字**。不要做任何加减乘除。
- **actions 必须来自 payload.suggestedActions**：从里面挑 1~3 条，可以调整语序和措辞，
  但其中的数字（克数、份数、缺口）**必须原样保留**。觉得不够就少写几条，不许自己补新的。
- **不许自己推算营养素含量**：不要写「补 12g 蛋白」这种由你算出来的数字，
  除非这个数字在 suggestedActions 里已经出现。
- 蛋白质缺口大于 60g 时，不要说「吃 XX 就能补齐」，直接说明要分几餐。
- 超出目标（remain < 0）时，不要说「明天少吃补回来」。补偿性节食会让记录失真。
- 蛋白质已经达标（proteinGap <= 0）就不要提蛋白质。
- 早上（hour < 11）不要说「今天吃多了」这类总结性判断，改说接下来怎么安排。
- 没有一条记录（meals 为空）时，不要编造摄入，只鼓励记第一餐。
- **caveats 只能来自 payload 的 dataNotes**。dataNotes 为空就返回空数组，
  不要自己判断「某项数据不全」—— 你看不到哪些营养素缺数据，猜一定是错的。
- **禁止**出现「注意营养均衡」「保持良好的饮食习惯」「多喝水」「适当运动」这类放到任何一天都成立的空话。
- 不要在正文里重复 headline 已经说过的话。

## 输出格式
严格输出一个 JSON 对象，不要 markdown、不要代码块、不要额外文字：
{
  "headline": "一句话结论，≤ 16 字，像人说话，不要'根据您的数据'这类开头",
  "body": "2~3 句解释，把'为什么'说清楚，≤ 90 字",
  "actions": ["具体动作，每条 ≤ 32 字，必须含食物名与克数，或明确的下一步"],
  "caveats": ["数据不可靠之处，如'钠只有 2 餐有数据'；没有就给空数组"]
}

actions 给 1~3 条，按重要性排序。每条都要能直接执行，
例如"加 150g 鸡胸肉或 2 个鸡蛋，补齐 23g 蛋白"，而不是"多吃高蛋白食物"。`;

export function buildAdviceText(payload: AdvicePayload): string {
  return `今天的记录如下（JSON，所有数字都是算好的，直接引用即可）：\n${JSON.stringify(payload, null, 0)}`;
}

export interface AdviceDoc {
  headline: string;
  body: string;
  actions: string[];
  caveats: string[];
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function list(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x, maxLen))
    .filter((x) => x.length > 0)
    .slice(0, maxItems);
}

/**
 * 清洗模型输出。headline 与 body 缺一个就整条作废 ——
 * 半条建议比没有建议更糟，界面会退回到本地规则建议。
 *
 * 另外对 actions 做**数字溯源**：出现的每个数字必须能在 allowedNumbers 里找到
 * （或者是 1~5 这种份数）。找不到就丢掉这条动作 ——
 * 宁可少一条建议，也不能让「150g 鸡胸肉补 45g 蛋白」这种错误流出去。
 */
export function parseAdvice(raw: unknown, allowedNumbers: number[] = []): AdviceDoc {
  const o = (raw ?? {}) as Record<string, unknown>;
  const headline = str(o.headline, 40);
  const body = str(o.body, 200);
  if (!headline || !body) throw new Error('建议缺少 headline 或 body');

  const allowed = allowedNumbers.filter((n) => Number.isFinite(n));
  const traceable = (n: number): boolean => {
    if (Number.isInteger(n) && n >= 1 && n <= 5) return true; // 份数：「2 个鸡蛋」「3 餐」
    return allowed.some((x) => Math.abs(x - n) <= 0.6);
  };

  const actions = list(o.actions, 3, 60).filter((a) => numbersIn(a).every(traceable));

  return {
    headline,
    body,
    actions,
    caveats: list(o.caveats, 3, 60),
  };
}

/** 抽取文本里的所有数字（含小数与千分位） */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? [])
    .map((s) => Number(s.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

/** 允许被引用的数字全集：payload 自己的数值 + 已算好的动作 + 已记录食物 */
export function adviceAllowedNumbers(p: AdvicePayload): number[] {
  const nums: number[] = [
    p.kcalTarget, p.kcalIntake, Math.abs(p.remain),
    p.proteinTarget, p.proteinIntake, Math.abs(p.proteinGap),
    p.fiberTarget, p.fiberIntake, Math.abs(p.fiberGap),
    p.saltLimitG,
  ];
  if (p.saltG != null) nums.push(p.saltG);
  for (const a of p.suggestedActions) nums.push(...numbersIn(a));
  for (const m of p.meals) {
    nums.push(m.kcal);
    for (const it of m.items) nums.push(...numbersIn(it));
  }
  return nums;
}
