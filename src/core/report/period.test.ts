import { describe, expect, it } from 'vitest';
import type { GoalSnapshot, Meal, WeightEntry } from '../db/types';
import { facts, type NutritionFacts } from '../nutrition/types';
import { makeItem, makeMeal } from '../meal/build';
import {
  KCAL_PER_KG_FAT, makeGoalResolver, periodRange, previousRange, smoothWeights,
  summarise, weightChange,
} from './period';

const TODAY = '2026-10-22';

function goal(kcal: number, over: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    id: `g_${kcal}_${over.effectiveFrom ?? '2026-01-01'}`,
    effectiveFrom: over.effectiveFrom ?? '2026-01-01',
    sourceProfileHash: 'h',
    goalType: 'lose',
    startWeightKg: 78,
    targetWeightKg: 70,
    paceKgPerWeek: 0.5,
    bmr: 1700,
    tdee: 2400,
    kcalFloor: 1600,
    kcal,
    dailyDeficit: 100,
    proteinG: over.proteinG ?? 131,
    fatG: 58,
    carbsG: 200,
    fiberG: 25,
    sodiumLimitMg: 2000,
    waterMl: 2500,
    micro: { calcium: 800, vc: 100, iron: 12, va: 800 },
    projectedDays: 120,
    warnings: [],
    createdAt: 0,
    ...over,
  };
}

/** 一条只含指定营养值的餐，克数精确可控 */
function mealAt(date: string, grams: number, per100g: Partial<NutritionFacts>): Meal {
  const item = makeItem({ name: '测试食物', per100g: facts(per100g), baseG: grams, grams });
  return makeMeal({ items: [item], date, slot: 'lunch' });
}

function weigh(date: string, kg: number): WeightEntry {
  return {
    id: `w_${date}`, date, weightKg: kg, bodyFatPct: null,
    waistCm: null, note: null, createdAt: 0,
  };
}

describe('周期区间', () => {
  it('周以周一为起点，且只把已过去的日子计入分母', () => {
    const r = periodRange('week', TODAY, TODAY);
    expect(r.from).toBe('2026-10-19'); // 周四 -> 本周一
    expect(r.to).toBe('2026-10-25');
    expect(r.elapsed).toHaveLength(4); // 19,20,21,22
    expect(r.label).toContain('本周');
  });

  it('月按自然月算，10 月是 31 天', () => {
    const r = periodRange('month', TODAY, TODAY);
    expect(r.from).toBe('2026-10-01');
    expect(r.to).toBe('2026-10-31');
    expect(r.elapsed).toHaveLength(22);
  });

  it('季度按 Q4 对齐', () => {
    const r = periodRange('quarter', TODAY, TODAY);
    expect(r.from).toBe('2026-10-01');
    expect(r.to).toBe('2026-12-31');
    expect(r.label).toContain('Q4');
  });

  it('上个周期紧邻当前周期，不留空档也不重叠', () => {
    const week = periodRange('week', TODAY, TODAY);
    const prev = previousRange('week', week.from, TODAY);
    expect(prev.to).toBe('2026-10-18');
    expect(prev.from).toBe('2026-10-12');
    expect(prev.elapsed).toHaveLength(7); // 已过去的周期，全部计入

    const month = periodRange('month', TODAY, TODAY);
    const prevMonth = previousRange('month', month.from, TODAY);
    expect(prevMonth.from).toBe('2026-09-01');
    expect(prevMonth.to).toBe('2026-09-30');
  });
});

describe('周期汇总', () => {
  const range = periodRange('week', TODAY, TODAY);
  const goalOf = makeGoalResolver([goal(1900)], goal(1900));

  it('没记录的日子不进平均值 —— 否则「只记了 2 天」会被算成「吃很少」', () => {
    const s = summarise(range, [
      mealAt('2026-10-21', 100, { kcal: 1800, protein: 100 }),
      mealAt('2026-10-22', 100, { kcal: 2000, protein: 140 }),
    ], goalOf);

    expect(s.recordedDays).toBe(2);
    expect(s.elapsedDays).toBe(4);
    expect(s.avgKcal).toBe(1900); // (1800+2000)/2，而不是 /4
    expect(s.coverage).toBe(0.5);
  });

  it('累计缺口换算成理论体重变化，用固定 7700 常数可复算', () => {
    // 两天各差 1900-1900=0、1900-1400=500 -> 累计缺口 500
    const s = summarise(range, [
      mealAt('2026-10-21', 100, { kcal: 1900 }),
      mealAt('2026-10-22', 100, { kcal: 1400 }),
    ], goalOf);
    expect(s.totalDeficit).toBe(500);
    // 缺口为正 => 体重下降 => 负数。符号写反过一次，这里必须守住
    expect(s.theoryKg).toBeCloseTo(-500 / KCAL_PER_KG_FAT, 10);
    expect(s.theoryKg!).toBeLessThan(0);
  });

  it('吃超目标时理论体重上升，符号与缺口相反', () => {
    const s = summarise(range, [
      mealAt('2026-10-21', 100, { kcal: 2400 }),
      mealAt('2026-10-22', 100, { kcal: 2400 }),
    ], goalOf);
    expect(s.totalDeficit).toBe(-1000);
    expect(s.theoryKg!).toBeGreaterThan(0);
    expect(s.theoryKg).toBeCloseTo(1000 / KCAL_PER_KG_FAT, 10);
  });

  it('达标判定用当天自己的目标，不用最新目标', () => {
    // 10-19 起目标从 1900 改成 1500，两天都吃 1500：
    // 前一天的旧目标 1900 会判「不达标」，后一天才达标
    const g = [goal(1500, { effectiveFrom: '2026-10-20' }), goal(1900, { effectiveFrom: '2026-01-01' })];
    const s = summarise(range, [
      mealAt('2026-10-19', 100, { kcal: 1500 }),
      mealAt('2026-10-20', 100, { kcal: 1500 }),
    ], makeGoalResolver(g, goal(1900)));

    expect(s.days.find((d) => d.day === '2026-10-19')?.goalKcal).toBe(1900);
    expect(s.days.find((d) => d.day === '2026-10-20')?.goalKcal).toBe(1500);
    expect(s.onTargetDays).toBe(1);
  });

  it('微量覆盖不足就不进缺口榜 —— 不能把「没匹配上食物库」说成「缺 VC」', () => {
    // VA 只有 100g 那条有，另一条 300g 没有 -> 覆盖 25%
    const withVa = makeItem({
      name: '胡萝卜', per100g: facts({ kcal: 39, va: 800 }), baseG: 100, grams: 100,
    });
    const withoutVa = makeItem({
      name: '米饭', per100g: facts({ kcal: 116 }), baseG: 300, grams: 300,
    });
    const mk = (date: string) => makeMeal({ items: [withVa, withoutVa], date, slot: 'lunch' });

    const s = summarise(range, [mk('2026-10-20'), mk('2026-10-21'), mk('2026-10-22')], goalOf);
    const day20 = s.days.find((d) => d.day === '2026-10-20')!;
    expect(day20.microCoverage.va).toBeCloseTo(0.25, 5);
    expect(day20.microReliable.va).toBe(false);
    expect(s.microGaps.some((g) => g.key === 'va')).toBe(false);
  });

  it('微量缺口需要至少 3 个可靠日，2 天不下结论', () => {
    const items = [
      makeItem({ name: '生菜', per100g: facts({ kcal: 15, vc: 10 }), baseG: 200, grams: 200 }),
    ];
    const mk = (date: string) => makeMeal({ items, date, slot: 'lunch' });
    // 目标 100mg，实际 20mg
    const twoDays = summarise(range, [mk('2026-10-21'), mk('2026-10-22')], goalOf);
    expect(twoDays.microGaps).toHaveLength(0);

    const threeDays = summarise(
      range, [mk('2026-10-20'), mk('2026-10-21'), mk('2026-10-22')], goalOf,
    );
    const vc = threeDays.microGaps.find((g) => g.key === 'vc');
    expect(vc).toBeTruthy();
    expect(vc!.ratio).toBeCloseTo(0.2, 5);
    expect(vc!.days).toBe(3);
  });

  it('钠按上限判断，不是达标目标', () => {
    const s = summarise(range, [
      mealAt('2026-10-21', 100, { kcal: 1800, sodium: 2600 }),
      mealAt('2026-10-22', 100, { kcal: 1800, sodium: 1500 }),
    ], goalOf);
    expect(s.sodiumOverDays).toBe(1);
  });

  it('不足 7 天不给周末/工作日对比，样本太少会得出假规律', () => {
    const short = summarise(range, [
      mealAt('2026-10-21', 100, { kcal: 1800 }),
      mealAt('2026-10-22', 100, { kcal: 2400 }),
    ], goalOf);
    expect(short.weekend).toBeNull();
    expect(short.weekday).toBeNull();
  });
});

describe('体重趋势', () => {
  it('7 日移动平均把单日的水分尖峰压下去', () => {
    const entries = [
      weigh('2026-10-01', 78.0), weigh('2026-10-02', 78.2), weigh('2026-10-03', 79.4),
      weigh('2026-10-04', 78.3), weigh('2026-10-05', 78.1),
    ];
    const pts = smoothWeights(entries);
    const spike = pts.find((p) => p.day === '2026-10-03')!;
    expect(spike.raw).toBe(79.4);
    expect(spike.ma).toBeCloseTo((78.0 + 78.2 + 79.4) / 3, 5);
    // 平滑后不会比原始波动更大
    expect(Math.abs(spike.ma! - 78.2)).toBeLessThan(Math.abs(spike.raw! - 78.2));
  });

  it('移动平均窗口是 7 天，8 天前的称重不参与', () => {
    const entries = [weigh('2026-10-01', 90), weigh('2026-10-09', 80)];
    const pts = smoothWeights(entries);
    expect(pts[1]!.ma).toBe(80);
  });

  it('称重少于 2 次没有实际变化可算', () => {
    expect(weightChange([weigh('2026-10-21', 78)], '2026-10-19', '2026-10-25')).toBeNull();
  });

  it('3 次以上称重用移动平均的起止值，不是首末原始值', () => {
    const entries = [
      weigh('2026-10-19', 78.0), weigh('2026-10-20', 78.0),
      weigh('2026-10-24', 77.0), weigh('2026-10-25', 76.0),
    ];
    const ch = weightChange(entries, '2026-10-19', '2026-10-25')!;
    expect(ch.method).toBe('ma');
    expect(ch.deltaKg).toBeLessThan(0);
    expect(ch.points).toBe(4);
  });
});
