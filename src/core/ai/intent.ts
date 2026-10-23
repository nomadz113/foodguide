/**
 * 自然语言意图解析 —— 提示词 + 结构校验。
 *
 * 设计要点：
 * 1. 只解析、不执行。这里产出的是「意图草稿」，写库必须等用户点一次保存（§6.3）。
 * 2. 必须区分 per_serving / per_100g ——「一碗 320 大卡」和「每 100g 320 大卡」差 2.5 倍，
 *    混淆了这个功能就是负价值。
 * 3. log_meal 必须估 per100g（用户没说营养值，不估就没法记账），
 *    但 create_food 只填用户说过的字段，多填一个字都是在编。
 * 4. 一句话里既有"记住"又有"吃了"时，优先 create_food —— 因为丢掉的营养数据找不回来。
 */

import { z } from 'zod';
import { NUTRIENT_KEYS, emptyFacts, type NutritionFacts } from '../nutrition/types';

export const IntentKind = z.enum([
  'create_food',
  'update_food',
  'delete_food',
  'log_meal',
  'update_meal',
  'delete_meal',
  'update_goal',
  'query_stats',
  'query_food',
  'clarify',
  'smalltalk',
  'unknown',
]);
export type IntentKind = z.infer<typeof IntentKind>;

/** 模型给的营养值表：键名放开，值只收数字或 null（null 表示"用户说了但不确定"） */
const FactsInput = z.record(z.string(), z.union([z.number(), z.null()]));

const ServingSchema = z.object({
  quantity: z.number().positive().catch(1),
  unit: z.string().catch('份'),
  grams: z.number().positive().catch(0),
});

const FoodPayload = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).catch([]),
  category: z.string().catch('自定义'),
  /** per_serving = 用户描述的是「一份/一碗」的值；per_100g = 用户描述的是每百克 */
  nutritionBasis: z.enum(['per_serving', 'per_100g']).catch('per_serving'),
  serving: ServingSchema.nullable().catch(null),
  values: FactsInput.catch({}),
});

const MealItemPayload = z.object({
  name: z.string().min(1),
  grams: z.number().positive(),
  dish: z.string().nullable().catch(null),
  /** 这一项的营养估算（每 100g）。库里有条目时会用库值覆盖它 */
  per100g: FactsInput.nullable().catch(null),
});

const MealPayload = z.object({
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).nullable().catch(null),
  /** YYYY-MM-DD；说"今天/刚才"就留 null，由前端按切日设置落位 */
  date: z.string().nullable().catch(null),
  items: z.array(MealItemPayload).catch([]),
});

export const IntentSchema = z.object({
  type: IntentKind,
  confidence: z.number().min(0).max(1).catch(0.5),
  reply: z.string().catch(''),
  food: FoodPayload.nullable().catch(null),
  meal: MealPayload.nullable().catch(null),
  /** 指向已存在的食物（update_food / delete_food / query_food） */
  target: z.object({ name: z.string().min(1) }).nullable().catch(null),
  assumptions: z.array(z.string()).catch([]),
  /** 用户没提供、因而保持 null 的营养项（中文名） */
  missing: z.array(z.string()).catch([]),
  caveats: z.array(z.string()).catch([]),
});

export type Intent = z.infer<typeof IntentSchema>;

const KEY_SET = new Set<string>(NUTRIENT_KEYS);

/**
 * 把模型给的松散字典收成 NutritionFacts。
 * 不认识的键直接丢；数值做量级钳制 —— 模型偶尔会写出 32000 这种。
 */
export function toFacts(input: Record<string, number | null> | null | undefined): NutritionFacts {
  const out = emptyFacts();
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (!KEY_SET.has(k)) continue;
    if (v === null || !Number.isFinite(v)) continue;
    const key = k as keyof NutritionFacts;
    // 热量上限 900kcal/100g（纯油脂 899），其余按 g/mg/μg 都远低于 100000
    const cap = key === 'kcal' ? 900 : 100_000;
    out[key] = Math.min(cap, Math.max(0, v));
  }
  return out;
}

/** 解析失败一律降级成 unknown，绝不让坏数据进到确认卡 */
export function parseIntent(raw: unknown): Intent {
  const r = IntentSchema.safeParse(raw);
  if (r.success) return r.data;
  return {
    type: 'unknown',
    confidence: 0,
    reply: '',
    food: null,
    meal: null,
    target: null,
    assumptions: [],
    missing: [],
    caveats: ['这条我没看懂，换个说法试试'],
  };
}

export const INTENT_SYSTEM_PROMPT = `你是中文饮食记账助手的意图解析器。用户会说一句话，你把它解析成一个 JSON 对象。
只输出 JSON，不要代码围栏，不要任何解释文字。

# 输出结构
{
  "type": "create_food | update_food | delete_food | log_meal | update_meal | delete_meal | update_goal | query_stats | query_food | clarify | smalltalk | unknown",
  "confidence": 0.0~1.0,
  "reply": "给用户看的一句话回执，20~40 字，口语，不要罗列数字",
  "food": null 或 {
    "name": "食物名",
    "aliases": ["别名"],
    "category": "自定义",
    "nutritionBasis": "per_serving" 或 "per_100g",
    "serving": { "quantity": 1, "unit": "碗", "grams": 250 },
    "values": { "kcal": 320, "protein": 18, "fat": 22, "carbs": 15 }
  },
  "meal": null 或 {
    "slot": "breakfast | lunch | dinner | snack | null",
    "date": "YYYY-MM-DD 或 null",
    "items": [ { "name": "番茄炒蛋", "grams": 260, "dish": null, "per100g": { "kcal": 96, "protein": 5.6, "fat": 6.4, "carbs": 4.5 } } ]
  },
  "target": null 或 { "name": "要改/要删的那个食物名" },
  "assumptions": ["你做的假设，每条一句话"],
  "missing": ["用户没说、你也没编的营养项中文名"],
  "caveats": ["需要提醒用户的风险"]
}

# type 怎么选
- 用户说「记住…」「以后都按…算」「这个菜是…」并给了营养数据 → create_food
- 用户要改一条已有的自定义食物 → update_food，target.name 填原名字
- 用户要删某条自定义食物 → delete_food
- 用户说「今天中午吃了…」「刚才喝了…」 → log_meal（即使没说营养值也要 log_meal，营养值你来估）
- 用户问「今天吃了多少」「这周热量」 → query_stats
- 用户问「红烧肉多少卡」「库里有没有…」 → query_food
- 缺关键信息、无法确定（没说是"记住"还是"吃了"、没说份量且差别很大） → clarify
- 闲聊、打招呼 → smalltalk
- 与饮食无关，或完全看不懂 → unknown

**一句话里既像"记住"又像"吃了"**：优先 create_food。营养数据丢了就找不回来，记账可以再记一次。

# create_food 的硬规则

## 1. 必须判断营养基准
- 「一碗 320 大卡」「一份…」「一个…」→ \`nutritionBasis: "per_serving"\`，把用户说的那份重量填进 \`serving.grams\`
- 「每 100 克 320 大卡」「100g 含…」→ \`nutritionBasis: "per_100g"\`，\`serving\` 填 null
这两种差 2.5 倍，判错了整个功能就是负价值。

## 2. 用户没说份量克数时，按这些锚点估，并写进 assumptions
一碗饭 150g / 一碗面 300g / 一碗粥 300g / 一盘炒菜 200g / 一份肉菜 120g /
一个鸡蛋 50g / 一杯奶 250g / 一碗红烧肉或炖菜 250g / 一个水果 150g / 一根香肠 60g

## 3. values 只填用户说过的
用户说了热量、蛋白、脂肪、碳水，就填这四项；没提纤维、钠、维生素，**就不要出现在 values 里**，
而是把中文名写进 missing。**不许补 0**，也不许凭"这道菜应该含多少"去填。
用户明确说"我不知道纤维多少"或给了"约/大概"之外的否定信息时同理。

## 4. 名字要能被将来匹配到
name 用用户的原话（「妈妈牌红烧肉」就照写），aliases 填用户可能脱口而出的简称（「红烧肉」「我妈做的红烧肉」）。

# log_meal 的硬规则

## 1. 必须给每一项估 per100g
用户只说"吃了什么"，没给营养值。你必须按中国食物成分表的口径给每 100g 的估算：
kcal / protein / fat / carbs 必填，fiber / sodium 尽量给，维生素矿物质可以不给。

## 2. 按入口状态，不是生重
米饭按熟饭 116 kcal/100g，面条按煮熟 110，粥按 46。不要填生米 346。

## 3. 复合菜要么拆、要么整，绝不并存
- 能拆（番茄炒蛋 → 番茄 + 鸡蛋 + 油）→ 只输出拆出的食材
- 拆不了（包子、饺子、肉丸、酱料混合成品）→ 只输出整条
同时出现「番茄炒蛋 260g」和「番茄 150g + 鸡蛋 100g」会让热量翻倍。**错，禁止**。

## 4. 油只跟着「拆解」走，整条保留的菜不许再列油
- 这道菜你**拆成了食材** → 才单独列油：清炒 10g / 红烧干煸 12g / 油炸 20g / 清蒸水煮 2g / 凉拌 6g。
  油的 per100g：kcal 899、fat 99.9、其余 0。
- 这道菜你**整条保留** → **绝对不要再列油**。它作为一道成菜，油已经在自己的 per100g 里了。
  反例（多算 90 kcal）：{name:"番茄炒蛋",grams:260} **又**加 {name:"食用油",grams:10}

**常见家常菜直接整条给，不要拆**：番茄炒蛋、宫保鸡丁、红烧肉、鱼香肉丝、麻婆豆腐、蒜蓉炒青菜、蛋炒饭……
这些是食物库里有按「含油成菜」整理好数据的品类，整条给反而更准。只有库里不太可能有的自制菜、
或用户明确说了配料的菜，才拆到食材。

## 5. 份量用锚点，和上面 create_food 的表一致
用户说"一碗""半盘""两个"时换算成克数填进 grams。

## 6. 餐次与日期
早上→breakfast，中午→lunch，晚上→dinner，下午/夜宵/加餐→snack。
说"今天""刚才"→ date 填 null（前端按切日设置落位）；说"昨天""前天"→ 换算成具体日期填上。

# 其它
- **指向已有食物的意图（query_food / delete_food / update_food）必须填 target.name**，
  填用户问的那样东西的名字，原话即可。「红烧肉多少卡？」→ target.name = "红烧肉"。
  只给 type 不给名字，前端就不知道该去查哪一条。
- query_stats / clarify / smalltalk / unknown：food 与 meal 都填 null，reply 写你要说的话。
- query_stats 的 reply 不要编数字，实际数字由前端算好再展示，你只说"我看看"这类过渡语。
- confidence < 0.6 时，caveats 里必须写清楚你在猜什么。
- 禁止输出 markdown、禁止输出 JSON 以外的文字。`;
