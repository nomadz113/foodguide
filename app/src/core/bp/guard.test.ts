import { describe, expect, it } from 'vitest';
import { checkReading, LIMITS, MMHG_PER_KPA, toMmHg } from './guard';

describe('单位换算', () => {
  it('mmHg 原样返回', () => {
    expect(toMmHg(132)).toBe(132);
  });

  it('kPa 换成 mmHg', () => {
    // 26.6 kPa × 7.5006 ≈ 199.5 → 200；11.9 kPa ≈ 89.3 → 89
    expect(toMmHg(26.6, 'kPa')).toBeCloseTo(199.5, 1);
    expect(toMmHg(11.9, 'kPa')).toBeCloseTo(89.3, 1);
    expect(MMHG_PER_KPA).toBeGreaterThan(7.5);
  });
});

describe('checkReading', () => {
  it('正常读数通过', () => {
    const r = checkReading({ systolic: 132, diastolic: 84, pulse: 74 });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.reading).toEqual({ systolic: 132, diastolic: 84, pulse: 74 });
  });

  it('没读到就是没读到：一律拦下让人补', () => {
    expect(checkReading({ systolic: null, diastolic: 84 })).toMatchObject({ ok: false, field: 'systolic' });
    expect(checkReading({ systolic: 132, diastolic: null })).toMatchObject({ ok: false, field: 'diastolic' });
    expect(checkReading({ systolic: Number.NaN, diastolic: 84 })).toMatchObject({ ok: false });
  });

  it('脉压没读到不算错 —— null 是未知，不是 0', () => {
    const r = checkReading({ systolic: 132, diastolic: 84, pulse: null });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.reading.pulse).toBeNull();
  });

  it('区间上下限：刚好在边界上通过', () => {
    expect(checkReading({ systolic: LIMITS.systolic[0], diastolic: 40 })).toMatchObject({ ok: true });
    expect(checkReading({ systolic: LIMITS.systolic[1], diastolic: LIMITS.diastolic[1] })).toMatchObject({ ok: true });
  });

  it('越界读数被拦下，而不是被「修正」', () => {
    expect(checkReading({ systolic: 40, diastolic: 60 })).toMatchObject({ ok: false, field: 'systolic' });
    expect(checkReading({ systolic: 300, diastolic: 80 })).toMatchObject({ ok: false, field: 'systolic' });
    expect(checkReading({ systolic: 132, diastolic: 200 })).toMatchObject({ ok: false, field: 'diastolic' });
    expect(checkReading({ systolic: 132, diastolic: 84, pulse: 400 })).toMatchObject({ ok: false, field: 'pulse' });
  });

  it('读数读反了必须拦：85/132 是最危险的一类错误', () => {
    const r = checkReading({ systolic: 85, diastolic: 132 });
    expect(r).toMatchObject({ ok: false, field: 'gap' });
  });

  it('脉压差不合理同样拦下', () => {
    expect(checkReading({ systolic: 100, diastolic: 95 })).toMatchObject({ ok: false, field: 'gap' });
  });

  it('老年人的宽脉压不能被误拦：190/70 是真实读数，脉压差 120', () => {
    expect(checkReading({ systolic: 190, diastolic: 70 })).toMatchObject({ ok: true });
  });

  it('单位换算后再查区间：把 kPa 当 mmHg 传进来会一路放行，所以必须先换算', () => {
    // 屏幕显示 kPa 的机型典型值：17.3/11.3 kPa = 130/85 mmHg
    const r = checkReading({ systolic: 17.3, diastolic: 11.3, unit: 'kPa' });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.converted).toBe(true);
      expect(r.reading).toEqual({ systolic: 130, diastolic: 85, pulse: null });
    }
    // 同样的数字、不声明单位 → 当场判为不可能的读数
    expect(checkReading({ systolic: 17.3, diastolic: 11.3 })).toMatchObject({ ok: false });
  });

  it('小数读数四舍五入到整数', () => {
    const r = checkReading({ systolic: 132.4, diastolic: 83.6, pulse: 73.5 });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.reading.systolic).toBe(132);
  });
});
