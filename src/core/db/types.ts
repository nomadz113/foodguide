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
  sodiumLimitMg: number;
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
    /** 钠折算成盐的克数，null=钠数据不足 */
    saltG: number | null;
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
  /** 已灌入的种子库版本 */
  seedVersion: number;
  lastBackupAt: number | null;
  updatedAt: number;
}
