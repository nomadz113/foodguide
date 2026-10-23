/**
 * 备份文件格式 —— 导出/导入的唯一契约。
 *
 * 这个文件存在的理由是一个物理事实：**IndexedDB 按 origin 隔离**。
 * 同一个 App 在「WorkBuddy 托管 / 腾讯云 / 离线 APK / 浏览器」下是四份互不相通的数据。
 * 用户换个入口，历史记录就凭空消失 —— 不是被删了，是读不到另一份。
 * 所以要有一个能拿在手上的文件，把数据从一个 origin 搬到另一个。
 *
 * 三条设计纪律：
 *
 * 1. **不导出 preset 食物。** 内置库由种子库生成，导入方 ensureSeed 自己就有，
 *    带上它只会把文件从 200KB 撑到 1MB，还会和本地种子库互相打架。
 * 2. **食物按 [nameKey+source] 匹配，不按 id。** 同一个自定义菜在两个 origin 里
 *    id 都是各自 nanoid 出来的，按 id 合并必然合并成两条同名的菜。
 * 3. **导入必须幂等。** 同一个文件导两次，结果和导一次完全相同。
 *    用户会重复点「导入」（第一次以为没成功），幂等是唯一能兜住这个行为的性质。
 */

import { z } from 'zod';
import { NUTRIENT_KEYS, emptyFacts } from '../nutrition/types';
import type {
  AdviceSnapshot, ChatMessage, Food, GoalSnapshot, Meal, Profile, Settings, WeightEntry,
} from '../db/types';

export const BACKUP_FORMAT = 'daily-intake-backup';
export const BACKUP_VERSION = 1;

/** 照片在备份里是 dataURL（Blob 进不了 JSON） */
export interface BackupPhoto {
  id: string;
  dataUrl: string;
  thumbDataUrl: string | null;
  mealId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface BackupIncludes {
  photos: boolean;
  apiKey: boolean;
}

export interface BackupData {
  profile: Profile | null;
  goals: GoalSnapshot[];
  meals: Meal[];
  /** 只含非 preset（custom / import / ai） */
  foods: Food[];
  weights: WeightEntry[];
  advices: AdviceSnapshot[];
  chat: ChatMessage[];
  photos: BackupPhoto[];
  /** 不含 seedVersion（见 applyBackup 注释） */
  settings: Settings | null;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: string;
  exportedAt: number;
  includes: BackupIncludes;
  data: BackupData;
}

// ── 校验 ──────────────────────────────────────────────────
/**
 * 营养值：缺字段按「未知」补齐，绝不留 undefined。
 * 渲染路径只读快照里的数字，缺一个键就是白屏，所以宁可补 null 也不能放过去。
 */
const factsSchema = z.preprocess(
  (v) => (v && typeof v === 'object' ? { ...emptyFacts(), ...(v as Record<string, unknown>) } : v),
  z.object(
    Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, z.number().nullable()])) as Record<
      string, z.ZodType<number | null>
    >,
  ),
);

const num = z.number().finite();

const profileSchema = z.object({
  id: z.literal('me'),
  sex: z.string(),
  birthDate: z.string(),
  heightCm: num,
  weightKg: num,
  bodyFatPct: num.nullable(),
  waistCm: num.nullable(),
  activityLevel: z.string(),
  exerciseTypes: z.array(z.string()),
  exerciseDaysPerWeek: num,
  goalType: z.string(),
  targetWeightKg: num.nullable(),
  paceKgPerWeek: num.nullable(),
  specialStates: z.array(z.string()),
  conditions: z.array(z.string()),
  allergies: z.array(z.string()),
  dietPrefs: z.array(z.string()),
  updatedAt: num,
});

const goalSchema = z.object({
  id: z.string(),
  effectiveFrom: z.string(),
  sourceProfileHash: z.string(),
  goalType: z.string(),
  startWeightKg: num,
  kcal: num,
  bmr: num,
  tdee: num,
  createdAt: num,
});

const mealItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  grams: num,
  baseG: num,
  per100g: factsSchema,
  nutrition: factsSchema,
  locked: z.boolean().optional(),
});

const mealSchema = z.object({
  id: z.string(),
  date: z.string(),
  eatenAt: num,
  slot: z.string(),
  source: z.string(),
  items: z.array(mealItemSchema),
  totals: factsSchema,
  goalId: z.string().nullable().optional(),
  createdAt: num,
  deletedAt: num.nullable().optional(),
});

const foodSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameKey: z.string(),
  aliases: z.array(z.string()).optional(),
  aliasKeys: z.array(z.string()).optional(),
  category: z.string(),
  source: z.string(),
  priority: num.optional(),
  per100g: factsSchema,
  serving: z.object({ quantity: num, unit: z.string(), grams: num }).nullable().optional(),
  edibleRatio: num.optional(),
  personalBias: num.optional(),
  usageCount: num.optional(),
  lastUsedAt: num.nullable().optional(),
  createdAt: num,
  updatedAt: num,
  deletedAt: num.nullable().optional(),
});

const weightSchema = z.object({
  id: z.string(),
  date: z.string(),
  weightKg: num,
  bodyFatPct: num.nullable().optional(),
  waistCm: num.nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: num,
});

const adviceSchema = z.object({
  id: z.string(),
  date: z.string(),
  goalId: z.string(),
  profileHash: z.string(),
  inputs: z.object({
    kcal: num, protein: num, fiber: num, mealCount: num, remain: num, saltG: num.nullable(),
  }),
  headline: z.string(),
  body: z.string(),
  actions: z.array(z.string()),
  caveats: z.array(z.string()),
  source: z.string(),
  model: z.string(),
  latencyMs: num,
  usage: z.object({
    promptTokens: num, completionTokens: num, costCny: num,
  }).nullable().optional(),
  createdAt: num,
});

const chatSchema = z.object({
  id: z.string(),
  date: z.string(),
  createdAt: num,
  role: z.string(),
  kind: z.string(),
  text: z.string(),
  status: z.string().nullable().optional(),
  relatedMealId: z.string().nullable().optional(),
  relatedFoodId: z.string().nullable().optional(),
});

const photoSchema = z.object({
  id: z.string(),
  dataUrl: z.string(),
  thumbDataUrl: z.string().nullable().optional(),
  mealId: z.string().nullable().optional(),
  createdAt: num,
  expiresAt: num,
});

const settingsSchema = z.object({
  id: z.literal('app'),
  mode: z.string(),
  provider: z.string(),
  visionModel: z.string(),
  textModel: z.string(),
  apiKeyCipher: z.string().nullable().optional(),
  jsonCapability: z.string(),
  imageMaxEdge: num,
  imageQuality: num,
  dayStartHour: num,
  autoPurgePhotosDays: num,
  categoryBias: z.record(z.string(), num).optional(),
  updatedAt: num,
});

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  app: z.string().optional(),
  exportedAt: num,
  includes: z.object({
    photos: z.boolean().optional(),
    apiKey: z.boolean().optional(),
  }).optional(),
  data: z.object({
    profile: profileSchema.nullable().optional(),
    goals: z.array(goalSchema).optional(),
    meals: z.array(mealSchema).optional(),
    foods: z.array(foodSchema).optional(),
    weights: z.array(weightSchema).optional(),
    advices: z.array(adviceSchema).optional(),
    chat: z.array(chatSchema).optional(),
    photos: z.array(photoSchema).optional(),
    settings: settingsSchema.nullable().optional(),
  }),
});

export type ParseResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; error: string };

/**
 * 解析备份文件。
 *
 * 校验是"骨架级"的：顶层结构、每行的主键与营养快照必须合法，
 * 其余字段（如 aiMeta、fieldSource、components）丢了也不影响导入后能正常渲染。
 * 刻意不要求全字段 —— 老版本导出的文件不能因为少一个字段就整个作废。
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }

  const r = backupSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first?.path?.join('.') || '顶层';
    return { ok: false, error: `文件结构不对（${path}）：${first?.message ?? '未知问题'}` };
  }

  const b = r.data;
  if (b.version > BACKUP_VERSION) {
    return { ok: false, error: `备份版本 v${b.version} 高于当前 App 能读的 v${BACKUP_VERSION}，请先更新 App` };
  }

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: b.version,
    app: b.app ?? '每日摄入指南',
    exportedAt: b.exportedAt,
    includes: {
      photos: b.includes?.photos ?? (b.data.photos?.length ?? 0) > 0,
      apiKey: b.includes?.apiKey ?? false,
    },
    data: {
      // zod 校验只保证骨架，这里按领域类型补默认值，交给下游当完整对象用
      profile: (b.data.profile ?? null) as Profile | null,
      goals: (b.data.goals ?? []) as GoalSnapshot[],
      meals: (b.data.meals ?? []) as Meal[],
      foods: (b.data.foods ?? []) as Food[],
      weights: (b.data.weights ?? []) as WeightEntry[],
      advices: (b.data.advices ?? []) as AdviceSnapshot[],
      chat: (b.data.chat ?? []) as ChatMessage[],
      photos: (b.data.photos ?? []) as BackupPhoto[],
      settings: (b.data.settings ?? null) as Settings | null,
    },
  };
  return { ok: true, backup };
}

/** 导入前的预览信息 —— 让用户先看清拿到的到底是什么文件 */
export interface BackupSummary {
  exportedAt: number;
  meals: number;
  days: number;
  from: string | null;
  to: string | null;
  foods: number;
  weights: number;
  goals: number;
  advices: number;
  chat: number;
  photos: number;
  hasKey: boolean;
  hasProfile: boolean;
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  const days = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;
  for (const m of b.data.meals) {
    // 回收站里的（软删）不计入预览：用户看到「12 餐」却导入 14 条会以为出错了
    if (m.deletedAt != null) continue;
    days.add(m.date);
    if (!from || m.date < from) from = m.date;
    if (!to || m.date > to) to = m.date;
  }
  return {
    exportedAt: b.exportedAt,
    meals: b.data.meals.filter((m) => m.deletedAt == null).length,
    days: days.size,
    from,
    to,
    foods: b.data.foods.length,
    weights: b.data.weights.length,
    goals: b.data.goals.length,
    advices: b.data.advices.length,
    chat: b.data.chat.length,
    photos: b.data.photos.length,
    hasKey: Boolean(b.data.settings?.apiKeyCipher),
    hasProfile: b.data.profile != null,
  };
}
