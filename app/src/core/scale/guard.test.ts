import { describe, expect, it } from 'vitest';
import { checkScaleReading, toKg, KG_PER_LB } from './guard';
import { LIMITS } from '../goal/engine';

describe('toKg', () => {
  it('kg 原样返回，不做无意义的舍入', () => {
    expect(toKg(72.4, 'kg')).toBe(72.4);
    expect(toKg(72.45, 'kg')).toBe(72.45);
  });

  it('lb 按国际磅定义换算并保留一位小数', () => {
    expect(toKg(158.9, 'lb')).toBeCloseTo(72.1, 5);
    expect(KG_PER_LB).toBe(0.45359237);
  });
});

describe('checkScaleReading', () => {
  it('正常 kg 读数直接通过', () => {
    const r = checkScaleReading({ weight: 72.4, unit: 'kg', bodyFatPct: 22.8 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reading.weightKg).toBe(72.4);
      expect(r.reading.bodyFatPct).toBe(22.8);
      expect(r.converted).toBe(false);
    }
  });

  it('没标注单位时按 kg 处理', () => {
    const r = checkScaleReading({ weight: 72.4, unit: null });
    expect(r.ok && r.reading.weightKg).toBe(72.4);
  });

  it('lb 先换算再查区间：158.9 lb 是 72.1 kg，不是 158.9 kg', () => {
    const r = checkScaleReading({ weight: 158.9, unit: 'lb' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reading.weightKg).toBeCloseTo(72.1, 5);
      expect(r.converted).toBe(true);
    }
  });

  it('lb 换算后才越界的情况要挡住（680 lb ≈ 308 kg），不能因为 680 > 300 就"恰好"拦住', () => {
    const r = checkScaleReading({ weight: 680, unit: 'lb' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe('weight');
      expect(r.reason).toContain('308.4');
    }
  });

  it('体重没读到时报错，不填默认值', () => {
    const r = checkScaleReading({ weight: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('没读到');
  });

  it('体重 0 / 负数 / 超上限都挡住，且标题带具体数值', () => {
    for (const w of [0, -5, LIMITS.weightKg[0] - 1, LIMITS.weightKg[1] + 1]) {
      const r = checkScaleReading({ weight: w, unit: 'kg' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/不在合理范围/);
    }
  });

  it('边界值本身是合法的（30 与 300）', () => {
    expect(checkScaleReading({ weight: LIMITS.weightKg[0], unit: 'kg' }).ok).toBe(true);
    expect(checkScaleReading({ weight: LIMITS.weightKg[1], unit: 'kg' }).ok).toBe(true);
  });

  it('体脂率缺失是 null，不是 0', () => {
    const r = checkScaleReading({ weight: 72.4, unit: 'kg', bodyFatPct: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reading.bodyFatPct).toBeNull();
  });

  it('体脂率 0 是错读（未测量时的 0.0%），要挡住而不是存成 0', () => {
    const r = checkScaleReading({ weight: 72.4, unit: 'kg', bodyFatPct: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe('bodyFatPct');
      expect(r.reason).toContain('核对截图');
    }
  });

  it('体脂率越界两端都挡，正常值放行', () => {
    expect(checkScaleReading({ weight: 72.4, bodyFatPct: LIMITS.bodyFatPct[0] - 0.1 }).ok).toBe(false);
    expect(checkScaleReading({ weight: 72.4, bodyFatPct: LIMITS.bodyFatPct[1] + 0.1 }).ok).toBe(false);
    expect(checkScaleReading({ weight: 72.4, bodyFatPct: LIMITS.bodyFatPct[0] }).ok).toBe(true);
    expect(checkScaleReading({ weight: 72.4, bodyFatPct: LIMITS.bodyFatPct[1] }).ok).toBe(true);
  });

  it('区间与档案校验共用同一份 LIMITS —— 识别放行就必须保证档案能存', () => {
    // 这条断言的价值是"防未来漂移"：谁哪天在 guard 里另加一套区间，这里会红
    expect(checkScaleReading({ weight: LIMITS.weightKg[0], unit: 'kg' }).ok).toBe(true);
    expect(checkScaleReading({ weight: LIMITS.weightKg[0] - 0.1, unit: 'kg' }).ok).toBe(false);
  });

  it('NaN / Infinity / 字符串不会被当成数字', () => {
    expect(checkScaleReading({ weight: NaN }).ok).toBe(false);
    expect(checkScaleReading({ weight: Infinity }).ok).toBe(false);
    // 类型上不允许，但模型解析层若漏了这种情况，防线只有这里
    expect(checkScaleReading({ weight: '72.4' as unknown as number }).ok).toBe(false);
  });
});
