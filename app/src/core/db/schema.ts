/**
 * Dexie 表结构 —— 索引定义的唯一真相。
 * 改索引必须新建 version，不要原地改 v1。
 */

import Dexie, { type Table } from 'dexie';
import type {
  AdviceSnapshot, BpEntry, ChatMessage, Food, GoalSnapshot, MatchMiss, Meal,
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
  bps!: Table<BpEntry, string>;
  misses!: Table<MatchMiss, string>;

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

    /**
     * v3：血压表。
     *
     * dayStartHour 会变，所以归档日 date 只能用于「等值或范围」查询，不能在索引里
     * 做任何跨天的假设；需要按真实时刻比大小时一律走 measuredAt。
     * 新表是空的，历史库不需要 upgrade 回调 —— Dexie 会自动建表，旧数据一行不动。
     */
    this.version(3).stores({
      bps: '&id, date, measuredAt, [date+measuredAt], source, deletedAt',
    });

    /**
     * v4：库缺口表（反哺）。
     *
     * 主键就是归一化的食物名 —— 聚合天然幂等，不需要自增 id。
     * 新表为空，不写 upgrade 回调，旧库升级时 Dexie 自己建表，原有数据一行不动。
     *
     * status 与 count 建索引是为了「只看待处理的」「按出现次数排序」两条查询，
     * 这张表的规模是几十到几百行，全表再过滤也无所谓，但索引不要钱。
     */
    this.version(4).stores({
      misses: '&nameKey, status, count, lastAt',
    });
  }
}

export const db = new IntakeDB();
