/**
 * 备份的读库与写库。
 *
 * 边界：这里只负责「把 DB 读成文件 / 把文件写回 DB」，
 * 冲突怎么判、谁赢，全部在 merge.ts 里，两边不要混 ——
 * 判据一旦掺进 IO，测试就只能连着 IndexedDB 一起跑，规则也就说不清楚了。
 */

import { db } from '../db/schema';
import { loadSettings, patchSettings, saveProfile } from '../db/repo';
import { dayKey } from '../date';
import type { PhotoRec, Settings } from '../db/types';
import {
  BACKUP_FORMAT, BACKUP_VERSION,
  type BackupFile, type BackupPhoto,
} from './types';
import {
  mergeAdvices, mergeChat, mergeFoods, mergeGoals, mergeMeals, mergeWeights,
  pickProfile, pickSettings, type MergeCounts,
} from './merge';

export interface ExportOptions {
  /** 照片体积大（一张几百 KB），默认不导 */
  photos: boolean;
  /** Key 是混淆存储、等同明文，默认不导（用户可显式勾选） */
  apiKey: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { photos: false, apiKey: false };

// ── Blob ⇄ dataURL ────────────────────────────────────────
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000; // 逐字符拼会在大图上卡死主线程，分块快得多
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const type = blob.type || 'image/jpeg';
  return `data:${type};base64,${btoa(bin)}`;
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return await res.blob();
}

// ── 导出 ──────────────────────────────────────────────────
/**
 * preset 食物不导：内置库由种子库生成，导入方 ensureSeed 自己就有。
 * 带上它只会把 200KB 的文件撑到 1MB，还会和本地种子库互相打架。
 */
export async function buildBackup(opts: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<BackupFile> {
  const [profile, goals, meals, foods, weights, advices, chat, settings] = await Promise.all([
    db.profile.get('me'),
    db.goals.toArray(),
    db.meals.toArray(),
    db.foods.toArray(),
    db.weights.toArray(),
    db.advices.toArray(),
    db.chat.toArray(),
    loadSettings(),
  ]);

  const ownFoods = foods.filter((f) => f.source !== 'preset');

  let photos: BackupPhoto[] = [];
  if (opts.photos) {
    const rows = await db.photos.toArray();
    photos = await Promise.all(rows.map(async (p) => ({
      id: p.id,
      dataUrl: await blobToDataUrl(p.blob),
      thumbDataUrl: p.thumb ? await blobToDataUrl(p.thumb) : null,
      mealId: p.mealId,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
    })));
  }

  const outSettings: Settings = { ...settings, apiKeyCipher: opts.apiKey ? settings.apiKeyCipher : null };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: '每日摄入指南',
    exportedAt: Date.now(),
    includes: { photos: opts.photos, apiKey: opts.apiKey },
    data: {
      profile: profile ?? null,
      goals,
      meals,
      foods: ownFoods,
      weights,
      advices,
      chat,
      photos,
      settings: outSettings,
    },
  };
}

export function serializeBackup(b: BackupFile): string {
  return JSON.stringify(b);
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `每日摄入-备份-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.json`;
}

// ── 导入 ──────────────────────────────────────────────────
export interface ImportSummary {
  counts: Record<'meals' | 'foods' | 'goals' | 'weights' | 'advices' | 'chat', MergeCounts> & {
    photos: number;
  };
  profileUpdated: boolean;
  keyRestored: boolean;
  settingsChanged: number;
}

/**
 * 合并式导入。**本机已有的记录不会被删** —— 只是把备份里缺的补进来、
 * 冲突的按「谁更新」取一方。同一个文件导两次结果不变（幂等）。
 *
 * 顺序有讲究：先写 settings（dayStartHour 决定「今天」怎么算），
 * 再写 profile 并重建目标快照，最后写业务表 ——
 * 反过来的话 ensureGoal 会拿旧的 dayStartHour 去算日期。
 */
export async function applyBackup(b: BackupFile): Promise<ImportSummary> {
  const incoming = b.data;
  const localSettings = await loadSettings();

  // 1) 设置（seedVersion 与已有 Key 不动，规则见 merge.ts）
  const { patch, keyRestored } = pickSettings(localSettings, incoming.settings);
  const settingsChanged = Object.keys(patch).length;
  let settings = localSettings;
  if (settingsChanged > 0) settings = await patchSettings(patch);
  const today = dayKey(new Date(), settings.dayStartHour);

  // 2) 档案：换了档案就得让它绑定的目标快照也生效
  const localProfile = (await db.profile.get('me')) ?? null;
  const { profile: nextProfile, changed: profileUpdated } = pickProfile(localProfile, incoming.profile);
  if (nextProfile) await saveProfile(nextProfile, today);

  // 3) 业务表
  const [localMeals, localFoods, localGoals, localWeights, localAdvices, localChat] = await Promise.all([
    db.meals.toArray(),
    db.foods.toArray(),
    db.goals.toArray(),
    db.weights.toArray(),
    db.advices.toArray(),
    db.chat.toArray(),
  ]);

  const meals = mergeMeals(localMeals, incoming.meals);
  const foods = mergeFoods(localFoods.filter((f) => f.source !== 'preset'), incoming.foods);
  const goals = mergeGoals(localGoals, incoming.goals);
  const weights = mergeWeights(localWeights, incoming.weights);
  const advices = mergeAdvices(localAdvices, incoming.advices);
  const chat = mergeChat(localChat, incoming.chat);

  // 一次事务写完：导入到一半失败时不能留下「餐次进来了、目标没进来」的半成品
  await db.transaction(
    'rw',
    [db.meals, db.foods, db.goals, db.weights, db.advices, db.chat],
    async () => {
      if (meals.rows.length) await db.meals.bulkPut(meals.rows);
      if (foods.rows.length) await db.foods.bulkPut(foods.rows);
      if (goals.rows.length) await db.goals.bulkPut(goals.rows);
      if (weights.rows.length) await db.weights.bulkPut(weights.rows);
      if (advices.rows.length) await db.advices.bulkPut(advices.rows);
      if (chat.rows.length) await db.chat.bulkPut(chat.rows);
    },
  );

  // 4) 照片：只补本地没有的，照片是缓存不是资产，没必要覆盖
  let photos = 0;
  if (incoming.photos.length > 0) {
    const have = new Set((await db.photos.toArray()).map((p) => p.id));
    const rows: PhotoRec[] = [];
    for (const p of incoming.photos) {
      if (have.has(p.id)) continue;
      rows.push({
        id: p.id,
        blob: await dataUrlToBlob(p.dataUrl),
        thumb: p.thumbDataUrl ? await dataUrlToBlob(p.thumbDataUrl) : null,
        mealId: p.mealId ?? null,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
      });
    }
    if (rows.length) {
      await db.photos.bulkPut(rows);
      photos = rows.length;
    }
  }

  await patchSettings({ lastBackupAt: Date.now() });

  return {
    counts: {
      meals: { added: meals.added, updated: meals.updated },
      foods: { added: foods.added, updated: foods.updated },
      goals: { added: goals.added, updated: goals.updated },
      weights: { added: weights.added, updated: weights.updated },
      advices: { added: advices.added, updated: advices.updated },
      chat: { added: chat.added, updated: chat.updated },
      photos,
    },
    profileUpdated,
    keyRestored,
    settingsChanged,
  };
}

/** 导出后记一笔时间，设置页要显示「上次备份」 */
export async function markExported(): Promise<void> {
  await patchSettings({ lastBackupAt: Date.now() });
}
