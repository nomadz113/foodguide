import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { bootstrap, ensureSeed, loadSettings, newProfile, patchSettings, saveMeal } from '../db/repo';
import { makeItem, makeMeal } from '../meal/build';
import { facts } from '../nutrition/types';
import { obfuscate, deobfuscate } from '../ai/keyStore';
import type { ChatMessage, Food, Meal } from '../db/types';
import { applyBackup, buildBackup, serializeBackup } from './backup';
import { mergeChat, mergeFoods, mergeMeals, pickSettings } from './merge';
import { parseBackup, summarizeBackup, type BackupFile } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await bootstrap();
});

function mealOn(date: string, name: string): Meal {
  return makeMeal({
    date,
    items: [makeItem({ name, baseG: 200, grams: 200, per100g: facts({ kcal: 120, protein: 5 }) })],
  });
}

function customFood(name: string, patch: Partial<Food> = {}): Food {
  return {
    id: `food_${name}`,
    name,
    nameKey: name,
    aliases: [],
    aliasKeys: [],
    category: '自定义',
    source: 'custom',
    priority: 100,
    per100g: facts({ kcal: 100 }),
    serving: null,
    edibleRatio: 1,
    personalBias: 1,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...patch,
  };
}

function chatMsg(id: string, createdAt: number): ChatMessage {
  return {
    id, date: '2026-10-20', createdAt, role: 'user', kind: 'text',
    text: id, intent: null, card: null, status: null, relatedMealId: null, relatedFoodId: null,
  };
}

describe('导出', () => {
  it('不导出 preset 食物 —— 内置库由种子库生成，带了只会打架', async () => {
    const b = await buildBackup();
    expect(b.data.foods.length).toBe(0);
    expect(b.data.foods.every((f) => f.source !== 'preset')).toBe(true);
    await db.foods.put(customFood('我家的米饭'));
    expect((await buildBackup()).data.foods.length).toBe(1);
  });

  it('默认不导出 API Key，勾选后才带', async () => {
    await patchSettings({ apiKeyCipher: obfuscate('sk-test-key-123456') });
    expect((await buildBackup()).data.settings?.apiKeyCipher).toBeNull();
    expect((await buildBackup({ photos: false, apiKey: true })).data.settings?.apiKeyCipher)
      .toBe(obfuscate('sk-test-key-123456'));
  });

  it('序列化后能被自己解析回来（往返一致）', async () => {
    await saveMeal(mealOn('2026-10-20', '番茄炒蛋'));
    await db.foods.put(customFood('我家的米饭'));
    const b = await buildBackup();
    const r = parseBackup(serializeBackup(b));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.meals.length).toBe(1);
    expect(r.backup.data.meals[0]!.items[0]!.name).toBe('番茄炒蛋');
    expect(r.backup.data.foods.length).toBe(1);
  });
});

describe('解析', () => {
  it('拒绝非本 App 的文件与坏 JSON', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"format":"other"}').ok).toBe(false);
    expect(parseBackup('{"format":"daily-intake-backup","version":1,"exportedAt":1,"data":{}}').ok).toBe(true);
  });

  it('拒绝高于当前版本的备份（读不懂就明说，不要静默丢数据）', () => {
    const r = parseBackup(JSON.stringify({
      format: 'daily-intake-backup', version: 99, exportedAt: 1, data: {},
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('版本');
  });

  it('营养快照缺字段时补 null，不让渲染路径拿到 undefined', () => {
    const r = parseBackup(JSON.stringify({
      format: 'daily-intake-backup', version: 1, exportedAt: 1,
      data: { meals: [{ id: 'm1', date: '2026-10-20', eatenAt: 1, slot: 'lunch', source: 'photo',
        items: [{ id: 'i1', name: '蛋', grams: 50, baseG: 50, per100g: { kcal: 100 }, nutrition: {} }],
        totals: {}, createdAt: 1 }] },
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.meals[0]!.items[0]!.nutrition.vc).toBeNull();
  });
});

describe('合并规则', () => {
  it('食物按 [nameKey+source] 合并，而不是 id —— 两个 origin 的 id 本来就不一样', () => {
    const local = [customFood('米饭', { id: 'food_AAA', per100g: facts({ kcal: 116 }) })];
    // 同一道菜在另一台设备上是另一个 id
    const incoming = [customFood('米饭', { id: 'food_ZZZ', per100g: facts({ kcal: 130 }), updatedAt: 2000 })];
    const r = mergeFoods(local, incoming);
    expect(r.added).toBe(0);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]!.id).toBe('food_AAA'); // 保留本地 id，已记录餐次的 foodId 才不会断
  });

  it('份量学习信号取并集/较大值，不被一次导入抹掉', () => {
    const local = [customFood('米饭', { id: 'a', usageCount: 7, biasSamples: [{ factor: 0.7, at: 10 }] })];
    const incoming = [customFood('米饭', { id: 'b', usageCount: 3, biasSamples: [{ factor: 1.3, at: 20 }], updatedAt: 5000 })];
    const r = mergeFoods(local, incoming);
    expect(r.rows[0]!.usageCount).toBe(7);
    expect(r.rows[0]!.biasSamples?.length).toBe(2);
  });

  it('导入是幂等的：同一个文件导两次，第二次什么都不写', () => {
    const local = [customFood('米饭', { id: 'a', updatedAt: 3000 })];
    const incoming = [customFood('米饭', { id: 'b', updatedAt: 3000 })];
    expect(mergeFoods(local, incoming).rows.length).toBe(0);

    const m = mealOn('2026-10-20', '面条');
    expect(mergeMeals([m], [{ ...m }]).rows.length).toBe(0);
  });

  it('聊天合并后 createdAt 必须严格递增，否则界面上会乱序', () => {
    // 两台设备的时间线各自递增，拼起来必然交叠
    const local = [chatMsg('a', 100), chatMsg('b', 101)];
    const incoming = [chatMsg('c', 100), chatMsg('d', 100)];
    const r = mergeChat(local, incoming);
    const all = [...local.filter((m) => !r.rows.some((x) => x.id === m.id)), ...r.rows]
      .sort((x, y) => x.createdAt - y.createdAt);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.createdAt).toBeGreaterThan(all[i - 1]!.createdAt);
    }
    expect(r.added).toBe(2);
  });

  it('设置：seedVersion 不导入，Key 只在本机没有时才恢复', () => {
    const base = { ...loadSettingsSyncStub(), seedVersion: 6, apiKeyCipher: null };
    const incoming = { ...base, seedVersion: 2, apiKeyCipher: 'xxx', dayStartHour: 4 };
    const a = pickSettings(base, incoming);
    expect(a.patch.seedVersion).toBeUndefined();
    expect(a.keyRestored).toBe(true);

    const b = pickSettings({ ...base, apiKeyCipher: 'yyy' }, incoming);
    expect(b.patch.apiKeyCipher).toBeUndefined(); // 本机已有 Key，不覆盖
    expect(b.keyRestored).toBe(false);
  });
});

function loadSettingsSyncStub() {
  return {
    id: 'app' as const, mode: 'direct' as const, provider: 'qwen' as const,
    visionModel: 'qwen3-vl-plus', textModel: 'qwen-plus', apiKeyCipher: null,
    jsonCapability: 'json_object' as const, imageMaxEdge: 1024, imageQuality: 0.82,
    dayStartHour: 0, autoPurgePhotosDays: 30, categoryBias: {}, seedVersion: 0,
    lastBackupAt: null, updatedAt: 0,
  };
}

describe('整库导入', () => {
  it('补进本地没有的餐次，且不动本地已有的记录', async () => {
    const mine = mealOn('2026-10-21', '本地的饭');
    await saveMeal(mine);

    const other = mealOn('2026-10-19', '另一台设备的饭');
    const backup: BackupFile = {
      format: 'daily-intake-backup', version: 1, app: '每日摄入指南', exportedAt: Date.now(),
      includes: { photos: false, apiKey: false },
      data: {
        profile: null, goals: [], meals: [other], foods: [], weights: [], advices: [],
        chat: [], photos: [], settings: null,
      },
    };
    const r = await applyBackup(backup);
    expect(r.counts.meals.added).toBe(1);
    expect(await db.meals.count()).toBe(2);
    expect((await db.meals.get(mine.id))?.items[0]!.name).toBe('本地的饭');
  });

  it('重复导入同一个文件，第二次不再产生新增', async () => {
    const m = mealOn('2026-10-19', '面条');
    const backup: BackupFile = {
      format: 'daily-intake-backup', version: 1, app: '每日摄入指南', exportedAt: Date.now(),
      includes: { photos: false, apiKey: false },
      data: {
        profile: null, goals: [], meals: [m], foods: [], weights: [], advices: [],
        chat: [], photos: [], settings: null,
      },
    };
    const first = await applyBackup(backup);
    const second = await applyBackup(backup);
    expect(first.counts.meals.added).toBe(1);
    expect(second.counts.meals.added).toBe(0);
    expect(await db.meals.count()).toBe(1);
  });

  it('导入不写入 seedVersion，否则本地会跳过灌种子（新 origin 将没有内置食物）', async () => {
    await patchSettings({ seedVersion: 0 });
    await db.foods.where('source').equals('preset').delete();
    const s = await loadSettings();
    const backup: BackupFile = {
      format: 'daily-intake-backup', version: 1, app: '每日摄入指南', exportedAt: Date.now(),
      includes: { photos: false, apiKey: true },
      data: {
        profile: null, goals: [], meals: [], foods: [], weights: [], advices: [],
        chat: [], photos: [],
        settings: { ...s, seedVersion: 6, apiKeyCipher: obfuscate('sk-from-backup') },
      },
    };
    await applyBackup(backup);
    expect((await loadSettings()).seedVersion).toBe(0);
    const seeded = await ensureSeed();
    expect(seeded).toBeGreaterThan(30); // 种子库确实被灌进来了
  });

  it('本机没有 Key 时从备份恢复，有 Key 时保留本机', async () => {
    const s = await loadSettings();
    const withKey = (key: string | null): BackupFile => ({
      format: 'daily-intake-backup', version: 1, app: '每日摄入指南', exportedAt: Date.now(),
      includes: { photos: false, apiKey: key != null },
      data: {
        profile: null, goals: [], meals: [], foods: [], weights: [], advices: [],
        chat: [], photos: [], settings: { ...s, apiKeyCipher: key },
      },
    });

    const r1 = await applyBackup(withKey(obfuscate('sk-backup-key')));
    expect(r1.keyRestored).toBe(true);
    expect(deobfuscate((await loadSettings()).apiKeyCipher)).toBe('sk-backup-key');

    await patchSettings({ apiKeyCipher: obfuscate('sk-my-own') });
    const r2 = await applyBackup(withKey(obfuscate('sk-backup-key')));
    expect(r2.keyRestored).toBe(false);
    expect(deobfuscate((await loadSettings()).apiKeyCipher)).toBe('sk-my-own');
  });

  it('档案取较新的一方，并重建目标快照', async () => {
    const p = newProfile();
    const backup: BackupFile = {
      format: 'daily-intake-backup', version: 1, app: '每日摄入指南', exportedAt: Date.now(),
      includes: { photos: false, apiKey: false },
      data: {
        profile: { ...p, weightKg: 71, targetWeightKg: 65, updatedAt: Date.now() + 10000 },
        goals: [], meals: [], foods: [], weights: [], advices: [], chat: [], photos: [], settings: null,
      },
    };
    const r = await applyBackup(backup);
    expect(r.profileUpdated).toBe(true);
    expect((await db.profile.get('me'))?.weightKg).toBe(71);
    expect(await db.goals.count()).toBeGreaterThanOrEqual(1);
  });

  it('导出的文件摘要不含回收站里的餐次（避免「显示 12 导入 14」的困惑）', async () => {
    const alive = mealOn('2026-10-20', '正常');
    await saveMeal(alive);
    await saveMeal({ ...mealOn('2026-10-20', '删掉的'), deletedAt: Date.now() });
    const b = await buildBackup();
    const sum = summarizeBackup(b);
    expect(b.data.meals.length).toBe(2); // 文件里保真，仍然带着
    expect(sum.meals).toBe(1);
    expect(sum.from).toBe('2026-10-20');
  });
});
