import { describe, expect, it } from 'vitest';
import {
  BP_LABEL, BP_TARGET_DEFAULT, HOME_BP_DAYS, MORNING, bpWindow, classify, compareBp, gradeOf,
  hourOf, isOnTarget, meanReading, pulsePressure, streakDays, summariseBp, toneOf, windowOf,
} from './engine';
import type { BpEntry } from '../db/types';

/**
 * 分级边界必须逐条钉死。
 *
 * 这些数字没有一个是可以「大概对」的：指南的分界是 140/90，写成 141 或漏掉「或」，
 * 都会让一部分用户被判成正常。测试用例取每个边界的两侧（139/89 与 140/90），
 * 而不是只测中间值 —— 差一才是这类 bug 的样子。
 */
describe('gradeOf 分级', () => {
  it('两侧取更严重的一侧', () => {
    expect(gradeOf({ systolic: 132, diastolic: 105 })).toBe(2); // 单看收缩压只有正常高值
    expect(gradeOf({ systolic: 175, diastolic: 82 })).toBe(2);  // 单看舒张压只有正常高值
  });

  it('边界：139/89 未达高血压门槛，140/90 已是 1 级', () => {
    expect(gradeOf({ systolic: 139, diastolic: 89 })).toBe(0);
    expect(gradeOf({ systolic: 140, diastolic: 89 })).toBe(1);
    expect(gradeOf({ systolic: 139, diastolic: 90 })).toBe(1);
  });

  it('边界：159/99 是 1 级，160/100 起是 2 级', () => {
    expect(gradeOf({ systolic: 159, diastolic: 99 })).toBe(1);
    expect(gradeOf({ systolic: 160, diastolic: 99 })).toBe(2);
    expect(gradeOf({ systolic: 159, diastolic: 100 })).toBe(2);
  });

  it('边界：179/109 是 2 级，180/110 起是 3 级', () => {
    expect(gradeOf({ systolic: 179, diastolic: 109 })).toBe(2);
    expect(gradeOf({ systolic: 180, diastolic: 109 })).toBe(3);
    expect(gradeOf({ systolic: 179, diastolic: 110 })).toBe(3);
  });
});

describe('classify 展示分类', () => {
  it('正常与正常高值', () => {
    expect(classify({ systolic: 118, diastolic: 76 })).toBe('normal');
    expect(classify({ systolic: 119, diastolic: 79 })).toBe('normal');
    expect(classify({ systolic: 120, diastolic: 79 })).toBe('highNormal');
    expect(classify({ systolic: 118, diastolic: 80 })).toBe('highNormal');
  });

  it('偏低先于一切：80/50 不会因为「不是高血压」就显示正常', () => {
    expect(classify({ systolic: 80, diastolic: 50 })).toBe('low');
    expect(classify({ systolic: 100, diastolic: 55 })).toBe('low');
  });

  it('单纯收缩期只在 1 级区间单独归类', () => {
    expect(classify({ systolic: 145, diastolic: 78 })).toBe('isolatedSystolic');
    // 收缩压已经 2 级时，紧要的事是「高」，不是「亚型」
    expect(classify({ systolic: 165, diastolic: 78 })).toBe('grade2');
    expect(classify({ systolic: 185, diastolic: 78 })).toBe('grade3');
  });

  it('每个分类都有中文标签，界面才不会出现 undefined', () => {
    const all = ['low', 'normal', 'highNormal', 'grade1', 'grade2', 'grade3', 'isolatedSystolic'] as const;
    for (const c of all) expect(BP_LABEL[c]).toBeTruthy();
  });

  it('tone 按「该有多在意」分档，145/78 与 150/95 同样是 high', () => {
    expect(toneOf({ systolic: 118, diastolic: 76 })).toBe('ok');
    expect(toneOf({ systolic: 126, diastolic: 82 })).toBe('warn');
    expect(toneOf({ systolic: 145, diastolic: 78 })).toBe('high');
    expect(toneOf({ systolic: 150, diastolic: 95 })).toBe('high');
    expect(toneOf({ systolic: 186, diastolic: 112 })).toBe('severe');
  });
});

describe('派生量', () => {
  it('脉压差', () => {
    expect(pulsePressure({ systolic: 132, diastolic: 84 })).toBe(48);
  });

  it('达标判定用「小于」而不是「小于等于」', () => {
    expect(isOnTarget({ systolic: 139, diastolic: 89 }, BP_TARGET_DEFAULT)).toBe(true);
    expect(isOnTarget({ systolic: 140, diastolic: 89 }, BP_TARGET_DEFAULT)).toBe(false);
  });

  it('个人目标 130/80 生效', () => {
    expect(isOnTarget({ systolic: 125, diastolic: 78 }, { systolic: 130, diastolic: 80 })).toBe(true);
    expect(isOnTarget({ systolic: 125, diastolic: 78 }, BP_TARGET_DEFAULT)).toBe(true);
    expect(isOnTarget({ systolic: 135, diastolic: 78 }, { systolic: 130, diastolic: 80 })).toBe(false);
  });

  it('空集的平均是 null，不是 0 —— 0/0 会被当成一条真记录', () => {
    expect(meanReading([])).toBeNull();
  });

  it('均值四舍五入到整数', () => {
    expect(meanReading([{ systolic: 120, diastolic: 80 }, { systolic: 131, diastolic: 81 }]))
      .toEqual({ systolic: 126, diastolic: 81 });
  });
});

describe('时段划分', () => {
  const at = (h: number) => new Date(2026, 9, 26, h, 30, 0).getTime();

  it('晨峰与晚峰的边界', () => {
    expect(windowOf(at(5))).toBe('other');
    expect(windowOf(at(6))).toBe('morning');
    expect(windowOf(at(9))).toBe('morning');
    expect(windowOf(at(10))).toBe('other');
    expect(windowOf(at(17))).toBe('other');
    expect(windowOf(at(18))).toBe('evening');
    expect(windowOf(at(21))).toBe('evening');
    expect(windowOf(at(22))).toBe('other');
    expect(hourOf(at(23))).toBe(23);
    expect(MORNING[1] > MORNING[0]).toBe(true);
  });
});

// ── 汇总 ──────────────────────────────────────────────────
let seq = 0;
function bp(date: string, hour: number, systolic: number, diastolic: number): BpEntry {
  seq += 1;
  return {
    id: `bp${seq}`,
    measuredAt: new Date(`${date}T${`${hour}`.padStart(2, '0')}:00:00`).getTime(),
    date,
    systolic,
    diastolic,
    pulse: null,
    device: null,
    source: 'manual',
    timeSource: 'now',
    flags: null,
    note: null,
    aiMeta: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
}

describe('compareBp：排序的两级 key', () => {
  it('测量时刻优先', () => {
    expect(compareBp({ measuredAt: 200, createdAt: 900 }, { measuredAt: 100, createdAt: 1 })).toBeGreaterThan(0);
  });

  it('同一时刻再比写入时刻', () => {
    expect(compareBp({ measuredAt: 100, createdAt: 200 }, { measuredAt: 100, createdAt: 100 })).toBeGreaterThan(0);
  });

  it('完全相同则返回 0（不靠主键抽奖）', () => {
    expect(compareBp({ measuredAt: 100, createdAt: 5 }, { measuredAt: 100, createdAt: 5 })).toBe(0);
  });
});

describe('summariseBp 汇总', () => {
  it('分母是有记录的天，不是窗口天数', () => {
    const s = summariseBp([bp('2026-10-20', 8, 120, 78), bp('2026-10-21', 8, 145, 92)]);
    expect(s.recordedDays).toBe(2);
    expect(s.onTargetDays).toBe(1); // 分母是 2 天，不是 7 天窗口
  });

  it('同一天多次测量先合成当天均值再判定达标，测得多不会天然更难看', () => {
    const s = summariseBp([
      bp('2026-10-20', 8, 150, 95),
      bp('2026-10-20', 20, 130, 85),
    ]);
    // 均值 140/90 → 不达标；但如果逐条判定，这天会被算成「有一条达标」
    expect(s.days).toHaveLength(1);
    expect(s.recordedDays).toBe(1);
    expect(s.onTargetDays).toBe(0);
  });

  it('软删的记录不进汇总', () => {
    const rows = [bp('2026-10-20', 8, 120, 78), bp('2026-10-21', 8, 190, 120)];
    rows[1]!.deletedAt = 2;
    const s = summariseBp(rows);
    expect(s.recordedDays).toBe(1);
    expect(s.mean).toEqual({ systolic: 120, diastolic: 78 });
  });

  it('晨/晚样本不足时不出对比结论', () => {
    const s = summariseBp([
      bp('2026-10-20', 7, 130, 82),
      bp('2026-10-21', 7, 132, 84),
      bp('2026-10-21', 20, 128, 80),
      bp('2026-10-22', 20, 126, 80),
    ]);
    expect(s.windowComparable).toBe(false);
  });

  it('晨/晚各满 3 条才给脸生物学解释', () => {
    const rows = [
      bp('2026-10-20', 7, 140, 88), bp('2026-10-21', 7, 142, 90), bp('2026-10-22', 7, 144, 88),
      bp('2026-10-20', 20, 118, 76), bp('2026-10-21', 20, 120, 78), bp('2026-10-22', 20, 116, 74),
    ];
    const s = summariseBp(rows);
    expect(s.windowComparable).toBe(true);
    expect(s.morningMean!.systolic).toBe(142);
    expect(s.eveningMean!.systolic).toBe(118);
  });

  it('趋势需要 6 条以上；样本不足返回 null', () => {
    expect(summariseBp([bp('2026-10-20', 8, 120, 80)]).trend).toBeNull();
    const rows = [
      bp('2026-10-20', 8, 130, 82), bp('2026-10-21', 8, 132, 82), bp('2026-10-22', 8, 134, 84),
      bp('2026-10-23', 8, 140, 86), bp('2026-10-24', 8, 142, 86), bp('2026-10-25', 8, 146, 88),
    ];
    const s = summariseBp(rows);
    expect(s.trend!.systolic).toBeGreaterThan(0); // 后半比前半高
  });

  it('空输入不炸', () => {
    const s = summariseBp([]);
    expect(s.recordedDays).toBe(0);
    expect(s.mean).toBeNull();
    expect(s.highest).toBeNull();
    expect(s.lowest).toBeNull();
    expect(s.trend).toBeNull();
  });
});

describe('streakDays 连续记录', () => {
  it('今天有记录则从今天数起', () => {
    expect(streakDays(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-26')).toBe(3);
  });

  it('今天还没测但昨天测了，连续性不算断', () => {
    expect(streakDays(['2026-10-24', '2026-10-25'], '2026-10-26')).toBe(2);
  });

  it('中间断一天就归零', () => {
    expect(streakDays(['2026-10-22', '2026-10-24', '2026-10-25'], '2026-10-26')).toBe(2);
  });

  it('一次都没记过是 0', () => {
    expect(streakDays([], '2026-10-26')).toBe(0);
  });
});

describe('bpWindow 首页回看窗口', () => {
  it('14 天窗口的首尾都含，长度正好 14', () => {
    const w = bpWindow('2026-10-27');
    expect(w.to).toBe('2026-10-27');
    // 减一不是笔误：首尾都算，27 号往回数 14 个日子是 14 号，不是 13 号
    expect(w.from).toBe('2026-10-14');
    expect(HOME_BP_DAYS).toBe(14);
  });

  it('跨月不会算错（10-27 往前 13 天是 10-14；11-03 往前 13 天是 10-21）', () => {
    expect(bpWindow('2026-11-03').from).toBe('2026-10-21');
    expect(bpWindow('2026-01-05').from).toBe('2025-12-23');
  });

  it('窗口长度可调，且至少 1 天', () => {
    expect(bpWindow('2026-10-27', 7)).toEqual({ from: '2026-10-21', to: '2026-10-27' });
    expect(bpWindow('2026-10-27', 1)).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    expect(bpWindow('2026-10-27', 0)).toEqual({ from: '2026-10-27', to: '2026-10-27' });
  });
});
