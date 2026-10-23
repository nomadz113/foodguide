/**
 * Dexie 表结构 —— 索引定义的唯一真相。
 * 改索引必须新建 version，不要原地改 v1。
 */

import Dexie, { type Table } from 'dexie';
import type {
  AdviceSnapshot, ChatMessage, Food, GoalSnapshot, Meal,
  PhotoRec, Profile, Settings, WeightEntry,
} from './types';

export const DB_NAME = 'daily-intake';

export class IntakeDB extends Dexie {
  foods!: Table<Food, string>;
  meals!: Table<Meal, string>;
  goals!: Table<GoalSnapshot, string>;
  profile!: Table<Profile, string>;
  weights!: Table<WeightEntry, string>;
  advices!: Table<AdviceSnapshot, string>;
  chat!: Table<ChatMessage, string>;
  photos!: Table<PhotoRec, string>;
  settings!: Table<Settings, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      foods: '&id, &nameKey, *aliasKeys, category, source, priority, lastUsedAt, deletedAt',
      meals: '&id, date, [date+slot], eatenAt, photoId, deletedAt',
      goals: '&id, effectiveFrom',
      profile: '&id',
      weights: '&id, &date',
      advices: '&id, date, [date+profileHash]',
      chat: '&id, date, createdAt, status',
      photos: '&id, createdAt, mealId, expiresAt',
      settings: '&id',
    });

    /**
     * v2：nameKey 从「唯一」放宽为「索引」，唯一性改由 [nameKey+source] 承担。
     *
     * 起因是一个真实场景：用户说「记住，我家的米饭一碗 200 克」。
     * 内置库里已经有「米饭」，而 v1 的 &nameKey 让用户那条根本插不进去（ConstraintError）。
     * 而「自定义优先于内置」正是 priority 存在的理由 —— 两者本来就该并存，
     * 匹配时按 priority 取自定义那条。
     *
     * 保留 [nameKey+source] 唯一，是为了防止用户把同一道菜存成两条自定义。
     */
    this.version(2).stores({
      foods: '&id, nameKey, &[nameKey+source], *aliasKeys, category, source, priority, lastUsedAt, deletedAt',
    });
  }
}

export const db = new IntakeDB();
