import { describe, expect, it } from 'vitest';
import { judge, MIN_COVERAGE, TOLERANCE_KG, type VerdictInput } from './verdict';

const base: VerdictInput = {
  theoryKg: -0.5,
  actualKg: -0.5,
  coverage: 0.9,
  elapsedDays: 7,
  goalType: 'lose',
  proteinHitRate: 0.8,
};

const j = (over: Partial<VerdictInput>) => judge({ ...base, ...over });

describe('理论 vs 实际判定', () => {
  it('差异在水分波动量级内就算吻合，不制造焦虑', () => {
    const v = j({ actualKg: -0.5 + (TOLERANCE_KG - 0.05) });
    expect(v.kind).toBe('onTrack');
    expect(v.impliedKcalPerDay).toBeNull();
  });

  it('实际比理论重 -> 摄入被低估，并折算成每天多少 kcal', () => {
    // 理论 -0.5，实际 +0.1 -> 差 0.6kg，7 天 -> 0.6*7700/7 ≈ 660 kcal/天
    const v = j({ theoryKg: -0.5, actualKg: 0.1 });
    expect(v.kind).toBe('estimateLow');
    expect(v.impliedKcalPerDay).toBe(660);
    expect(v.body).toContain('660');
    // 要指出最可能的具体来源，而不是笼统说「注意饮食」
    expect(v.body).toContain('烹调油');
  });

  it('掉得比理论快 -> 提醒可能掉肌肉，蛋白不达标时语气加重', () => {
    const v = j({ theoryKg: -0.4, actualKg: -1.2, proteinHitRate: 0.3 });
    expect(v.kind).toBe('dropTooFast');
    expect(v.tone).toBe('bad');
    expect(v.body).toContain('肌肉');
    const ok = j({ theoryKg: -0.4, actualKg: -1.2, proteinHitRate: 0.9 });
    expect(ok.tone).toBe('warn');
  });

  it('记录覆盖不足时拒绝下结论', () => {
    const v = j({ coverage: MIN_COVERAGE - 0.05 });
    expect(v.kind).toBe('lowCoverage');
    expect(v.headline).toContain('不下结论');
  });

  it('理论缺口离谱时先怀疑漏记，而不是夸用户瘦得快', () => {
    // 7 天掉 1.8kg = 每周 1.8kg > 1.5kg 阈值
    const v = j({ theoryKg: -1.8, actualKg: -1.8 });
    expect(v.kind).toBe('dataSuspect');
    expect(v.body).toContain('漏');
  });

  it('只有理论值没有称重时，明确告诉用户缺什么', () => {
    const v = j({ actualKg: null });
    expect(v.kind).toBe('noWeight');
    expect(v.body).toContain('称');
  });

  it('周期拉长后速度阈值按周归一化，不会因为月报就误报离谱', () => {
    // 30 天理论 -2.0kg ≈ 每周 0.47kg，完全正常
    const v = j({ theoryKg: -2.0, actualKg: -1.95, elapsedDays: 30 });
    expect(v.kind).toBe('onTrack');
  });

  it('维持体重的目标不套用减脂口径', () => {
    const v = j({ goalType: 'maintain', theoryKg: 0.1, actualKg: 0.6 });
    expect(v.kind).toBe('estimateLow');
    expect(v.body).not.toContain('缺口应该有');
  });
});

describe('容差随周期放大', () => {
  it('同样的 0.6kg 偏差，一周是异常，一个月是正常', () => {
    const week = judge({
      theoryKg: -1.0, actualKg: -0.4, coverage: 1, elapsedDays: 7,
      goalType: 'lose', proteinHitRate: 0.9,
    });
    expect(week.kind).toBe('estimateLow');

    const month = judge({
      theoryKg: -1.0, actualKg: -0.4, coverage: 1, elapsedDays: 30,
      goalType: 'lose', proteinHitRate: 0.9,
    });
    expect(month.kind).toBe('onTrack');
  });

  it('容差上限不会大到什么都判不出来', () => {
    // 季度也就 ±1kg 左右，差 1.5kg 仍然要报
    const v = judge({
      theoryKg: -2, actualKg: -3.5, coverage: 1, elapsedDays: 90,
      goalType: 'lose', proteinHitRate: 0.9,
    });
    expect(v.kind).toBe('dropTooFast');
  });
});
