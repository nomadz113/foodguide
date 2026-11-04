/**
 * 领域类型定义。
 *
 * 铁律：meals.items[] 自带完整营养数值（快照），绝不通过 foodId join foods 取数。
 * 改食物库值、改档案、改目标，都不得篡改历史记录。
 */

import type { NutritionFacts } from '../nutrition/types';
import type { Sex, SpecialState } from '../nutrition/dri';

export type { Sex, SpecialState };

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain' | 'health';
export type ExerciseType = 'strength' | 'cardio' | 'hiit' | 'none';
export type Condition = 'diabetes' | 'hypertension' | 'hyperlipidemia' | 'gout' | 'kidney';
export type DietPref =
  | 'vegetarian' | 'vegan' | 'halal'
  | 'no_seafood' | 'no_pork' | 'no_beef' | 'low_lactose';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

// ── 个人档案 ──────────────────────────────────────────────
export interface Profile {
  id: 'me';
  sex: Sex;
  /** YYYY-MM-DD，用日期而非年龄，避免长期使用后失真 */
  birthDate: string;
  heightCm: number;
  weightKg: number;
  bodyFatPct: number | null;
  waistCm: number | null;
  activityLevel: ActivityLevel;
  exerciseTypes: ExerciseType[];
  exerciseDaysPerWeek: number;
  goalType: GoalType;
  targetWeightKg: number | null;
  /** 期望速度 kg/周 */
  paceKgPerWeek: number | null;
  specialStates: SpecialState[];
  conditions: Condition[];
  allergies: string[];
  dietPrefs: DietPref[];
  /**
   * 首次引导完成的时间戳。`null` = 还没走完引导。
   *
   * 为 null 时上面那些数值**只是表单占位**，不代表这个人：不能拿去算 BMR、
   * 不能拿来生成目标、更不能写进体重表。在此之前 App 只渲染 /welcome。
   *
   * 老用户迁移：没有这个字段的历史档案一律视为已完成（见 bootstrap）。
   */
  onboardedAt: number | null;
  updatedAt: number;
}

// ── 目标快照（由档案算出，版本化） ─────────────────────────
export interface GoalSnapshot {
  id: string;
  /** 生效日 YYYY-MM-DD */
  effectiveFrom: string;
  /** 档案指纹：档案变了才重算 */
  sourceProfileHash: string;
  goalType: GoalType;
  startWeightKg: number;
  targetWeightKg: number | null;
  paceKgPerWeek: number | null;

  bmr: number;
  tdee: number;
  /** 安全下限 */
  kcalFloor: number;
  kcal: number;
  /** 实际每日缺口（目标热量与 TDEE 之差） */
  dailyDeficit: number;

  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;

  micro: Partial<NutritionFacts>;
  /** 预计达成所需自然日，无法预估时为 null */
  projectedDays: number | null;
  warnings: string[];
  createdAt: number;
}

// ── 食物库 ────────────────────────────────────────────────
export type FoodSource = 'custom' | 'import' | 'preset' | 'ai';

export interface Food {
  id: string;
  name: string;
  /** 归一化唯一键 */
  nameKey: string;
  aliases: string[];
  aliasKeys: string[];
  /**
   * 用户自己补的别名 —— 必须与 aliases 分开存。
   *
   * aliases 是种子数据的一部分：ensureSeed 在版本升级时用 SEED_FOODS 里的值
   * **整段覆盖** aliases/aliasKeys（那是刷新公共数据，正确行为）。如果用户给
   * 「白菜」补的「大白菜」也写进 aliases，下次升种子就被抹掉了。
   * userAliases 不在 ensureSeed 的更新字段里，所以能活下来。
   * 读取时一律 aliases + userAliases 合并使用（见 match.ts / normalize.ts）。
   */
  userAliases?: string[];
  category: string;
  source: FoodSource;
  /** custom 100 / import 80 / preset 50 / ai 20 */
  priority: number;
  per100g: NutritionFacts;
  serving: { quantity: number; unit: string; grams: number } | null;
  edibleRatio: number;
  /** 个人偏置系数（三档份量学习信号） */
  personalBias: number;
  /** 档位选择历史，最多保留 20 条 */
  biasSamples?: TierSample[];
  usageCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

// ── 餐次 ──────────────────────────────────────────────────
export type PortionTier = 'small' | 'medium' | 'large';

/** 用户点过的一次档位选择，用于学习个人偏置 */
export interface TierSample {
  /** 档位倍率 0.7 / 1.0 / 1.3 */
  factor: number;
  at: number;
}
export type MatchType = 'custom' | 'library' | 'ai' | 'manual';

export interface MealItem {
  id: string;
  name: string;
  rawName: string | null;
  /** 复合菜拆解层级：所属菜品名 */
  parentDish: string | null;
  foodId: string | null;
  matchType: MatchType;
  matchScore: number | null;

  grams: number;
  /** AI 给的基准份（= 中等档），改档位时据此重算 */
  baseG: number;
  portionTier: PortionTier | null;
  /** 用户是否真的点过档位。默认中份不算样本，否则学习信号会被"没表态"污染 */
  tierConfirmed: boolean;
  /** 档位缩放的阻尼，烹调油 0.5（不随菜量线性增长），默认 1 */
  scaleDamp?: number;
  /** 固定份量（如「1 瓶 500ml」），不参与整餐缩放 */
  scaleFixed?: boolean;
  quantity: number | null;
  unit: string | null;
  gramSource: 'ai' | 'library' | 'user';

  /** 反推缓存：改份量时按比例缩放 */
  per100g: NutritionFacts;
  /** 绝对量快照 —— 渲染与汇总只读这个 */
  nutrition: NutritionFacts;
  fieldSource: Partial<Record<keyof NutritionFacts, 'ai' | 'library' | 'fill'>>;

  components: { name: string; grams: number; kcal: number }[] | null;
  confidence: number;
  /** 用户手动改过，批量调整时跳过 */
  locked: boolean;
}

export interface Meal {
  id: string;
  /** YYYY-MM-DD，按 dayStartHour 切日 */
  date: string;
  eatenAt: number;
  slot: MealSlot;
  source: 'photo' | 'text' | 'manual';
  photoId: string | null;
  items: MealItem[];
  totals: NutritionFacts;
  coverage: Partial<Record<keyof NutritionFacts, number>>;
  goalId: string | null;
  aiMeta: {
    provider: string;
    model: string;
    promptVersion: string;
    latencyMs: number;
    jsonMode: string;
    repaired: boolean;
  } | null;
  createdAt: number;
  deletedAt: number | null;
}

// ── 体重记录 ──────────────────────────────────────────────
export interface WeightEntry {
  id: string;
  /** YYYY-MM-DD，每天一条 */
  date: string;
  weightKg: number;
  bodyFatPct: number | null;
  waistCm: number | null;
  note: string | null;
  createdAt: number;
}

// ── 血压记录 ──────────────────────────────────────────────
/**
 * 测量时间的来源。
 *
 * 落盘是为了能在 UI 上如实标注，而不是假装每个时间都很准 —— 这几档的
 * 精度差得很远：屏显是机器显示的测量时刻，EXIF 是拍照时刻，文件名是伴随信息，
 * mtime 可能已经被某次传输改掉了。补录旧数据时，这几档能差出好几天。
 */
export type BpTimeSource = 'display' | 'exif' | 'filename' | 'mtime' | 'now' | 'user';

/**
 * 血压分级。分级办法见 core/bp/engine.ts —— grade 由代码算，不来自模型。
 * low 单独留一档：低于 90/60 虽然不是高血压，但用户会想知道为什么头晕。
 */
export type BpCategory =
  | 'low'
  | 'normal'
  | 'highNormal'
  | 'grade1'
  | 'grade2'
  | 'grade3'
  | 'isolatedSystolic';

export interface BpFlags {
  /** 屏幕出现心律不齐图标 */
  irregular: boolean | null;
  /** 屏幕显示的是平均值或历史记忆值，不是当次测量 */
  avg: boolean | null;
  /**
   * 模型读到的原始片段，如 ["132/85", "P 74"]。
   * 留它的唯一理由：不存照片，数字一旦有出入，这是唯一能回溯的凭据 ——
   * 能分清「模型读错了」还是「机器当时就是这么显示的」。成本是几十字节。
   */
  raw: string[];
}

export interface BpEntry {
  id: string;
  /** 测量时刻（毫秒）。真值，与归档日分开存 */
  measuredAt: number;
  /** YYYY-MM-DD，按 dayStartHour 切日，与 meals 同口径 */
  date: string;
  systolic: number;
  diastolic: number;
  /** null = 这次没读到，不是 0（沿用全项目约定） */
  pulse: number | null;
  /** 血压计型号；拍照识别出来的，空就是没印 */
  device: string | null;
  source: 'photo' | 'manual' | 'import';
  timeSource: BpTimeSource;
  flags: BpFlags | null;
  note: string | null;
  /** 与 Meal.aiMeta 同构：provider/model/promptVersion/latencyMs/jsonMode/repaired */
  aiMeta: Meal['aiMeta'];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

// ── AI 建议快照 ───────────────────────────────────────────
/**
 * 每日建议快照。
 *
 * 存 inputs 是为了判断「建议是否已经过期」：用户生成建议后又补记了一餐，
 * 那条建议的依据就变了，必须能识别出来而不是继续展示旧结论。
 */
export interface AdviceSnapshot {
  id: string;
  date: string;
  goalId: string;
  profileHash: string;
  inputs: {
    kcal: number;
    protein: number;
    fiber: number;
    mealCount: number;
    /** 还可摄入（负数=已超） */
    remain: number;
  };
  headline: string;
  body: string;
  /** 具体可执行的动作，每条都必须带数字或明确的食物+克数 */
  actions: string[];
  caveats: string[];
  source: 'ai' | 'local';
  model: string;
  latencyMs: number;
  /** 这次生成花了多少 token / 多少钱，便于在设置页做成本透明 */
  usage: { promptTokens: number; completionTokens: number; costCny: number } | null;
  createdAt: number;
}

// ── 对话 ──────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  date: string;
  createdAt: number;
  role: 'user' | 'assistant';
  kind: 'text' | 'intent_card' | 'result';
  text: string;
  intent: unknown | null;
  card: unknown | null;
  status: 'pending' | 'confirmed' | 'applied' | 'rejected' | null;
  relatedMealId: string | null;
  relatedFoodId: string | null;
}

// ── 图片 ──────────────────────────────────────────────────
export interface PhotoRec {
  id: string;
  blob: Blob;
  thumb: Blob | null;
  mealId: string | null;
  createdAt: number;
  expiresAt: number;
}

// ── 设置 ──────────────────────────────────────────────────
/** 外观：跟随系统 / 强制浅色 / 强制深色 */
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  id: 'app';
  mode: 'direct' | 'proxy';
  provider: 'qwen' | 'glm' | 'doubao';
  visionModel: string;
  textModel: string;
  /** 加密后的 Key，永不明文落盘 */
  apiKeyCipher: string | null;
  jsonCapability: 'json_schema' | 'json_object' | 'prompt';
  imageMaxEdge: number;
  imageQuality: number;
  /** 每天几点切日（熬夜场景 4 点前算前一天） */
  dayStartHour: number;
  autoPurgePhotosDays: number;
  /** 各类食物的基准份个人偏置 */
  categoryBias: Record<string, number>;
  /**
   * 外观：跟随系统 / 强制浅色 / 强制深色。
   * 注意 pickSettings 用的是**白名单**，没列进去的字段不会被导入 ——
   * 所以换设备恢复备份时主题不会跟着搬过来，这是有意的：外观是本机的偏好。
   */
  theme: ThemeMode;
  /** 已灌入的种子库版本 */
  seedVersion: number;
  lastBackupAt: number | null;
  updatedAt: number;
}

// ── 库缺口（反哺） ────────────────────────────────────────
/**
 * 「AI 认出来了，但食物库里没有」的名字 —— 让库按用户真实吃的东西长大。
 *
 * 主键是归一化名 nameKey，不是自增 id：同一种写法出现多次天然聚合成一条，
 * 连拍三次同一道菜就是 count=3，不会堆出三条记录。
 *
 * 这里**不存营养值**作为权威数据 —— per100g 只是「最近一次 AI 给这盘菜的估算」，
 * 用途是入册时预填表单，绝不是可入库的营养事实（微矿依然是空的）。
 */
export type MissKind = 'ingredient' | 'dish';
export type MissStatus = 'open' | 'added' | 'dismissed';

export interface MatchMiss {
  nameKey: string;
  /** 最近一次的原始写法，展示用（大小写/修饰语以用户实际用语为准） */
  name: string;
  count: number;
  firstAt: number;
  lastAt: number;
  /** 最近 ≤10 次的实际克数，入册时取中位数当默认份量 */
  grams: number[];
  /** 最近一次 AI 给的 per100g（含油盐的「这盘菜」口径），仅用于预填 */
  per100g: NutritionFacts;
  /**
   * 最像的库条目的（本地算的 bigram 相似度）。
   * matched=true 表示当时**命中了但它没补上任何微量** —— 大概率认错了，
   * 比完全没命中更值得看一眼（错配比留空更糟）。
   */
  near: { name: string; score: number; matched: boolean } | null;
  /** dish 不建议入册：同名菜品每次做法不同，存成固定 per100g 是给未来埋错 */
  kind: MissKind;
  status: MissStatus;
}
