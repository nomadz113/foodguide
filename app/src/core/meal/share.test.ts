import { describe, expect, it } from 'vitest';
import {
  SHARE_FACTORS,
  SHARE_LABELS,
  SHARE_ORDER,
  eatenGrams,
  loadShareDefault,
  nearestShareTier,
  saveShareDefault,
  shareFactor,
  shareNote,
  wholeFromEaten,
} from './share';

describe('share 档位定义', () => {
  it('三档互不相同且全部 = 1', () => {
    expect(SHARE_FACTORS.all).toBe(1);
    expect(SHARE_FACTORS.half).toBe(0.5);
    expect(SHARE_FACTORS.third).toBeCloseTo(0.34, 5);
    expect(new Set(SHARE_ORDER).size).toBe(3);
  });

  it('每档都有中文标签', () => {
    for (const t of SHARE_ORDER) expect(SHARE_LABELS[t]).toBeTruthy();
  });

  it('没给档位时按全部算', () => {
    expect(shareFactor(null)).toBe(1);
    expect(shareFactor(undefined)).toBe(1);
  });
});

describe('nearestShareTier：模型给的比例归到档位', () => {
  it('0.5 归到一半、0.33 归到三分之一', () => {
    expect(nearestShareTier(0.5)).toBe('half');
    expect(nearestShareTier(0.33)).toBe('third');
    expect(nearestShareTier(0.34)).toBe('third');
  });

  it('没给 / 非数字 / 越界 → null（不折算）', () => {
    expect(nearestShareTier(null)).toBeNull();
    expect(nearestShareTier(undefined)).toBeNull();
    expect(nearestShareTier('abc')).toBeNull();
    expect(nearestShareTier(1)).toBeNull();
    expect(nearestShareTier(0.1)).toBeNull();
    expect(nearestShareTier(-0.3)).toBeNull();
  });

  it('0.8 以上当全部 —— 差 0.2 以内不值得多记一次折算', () => {
    expect(nearestShareTier(0.85)).toBeNull();
    expect(nearestShareTier(0.9)).toBeNull();
  });

  it('0.2 落在三分之一（离 0.34 比离 0.5 近）', () => {
    expect(nearestShareTier(0.2)).toBe('third');
  });
});

describe('eatenGrams：整份 → 吃到的那份', () => {
  it('全部时原样返回（保留 1 位小数）', () => {
    expect(eatenGrams(200, 1)).toBe(200);
    expect(eatenGrams(2.46, 1)).toBe(2.5);
  });

  it('三分之一与一半', () => {
    expect(eatenGrams(600, SHARE_FACTORS.third)).toBe(204);
    expect(eatenGrams(200, SHARE_FACTORS.half)).toBe(100);
    expect(eatenGrams(2, SHARE_FACTORS.third)).toBe(0.7);
  });

  it('20g 以上取整（不出现 206.9g 这种假精确），以下留 1 位小数', () => {
    expect(eatenGrams(609, SHARE_FACTORS.third)).toBe(207);
    expect(eatenGrams(19.9, SHARE_FACTORS.third)).toBe(6.8);
    expect(eatenGrams(60, SHARE_FACTORS.third)).toBe(20);
  });

  it('最少 0.1g —— 记 0 克等于没吃，不如让用户删条目', () => {
    // 这里**不能**用 0.5g 兜底：0.3g 的盐折三分之一只剩 0.1g，抬到 0.5 等于凭空放大 5 倍
    expect(eatenGrams(0, 1)).toBe(0.1);
    expect(eatenGrams(1, SHARE_FACTORS.third)).toBe(0.3);
  });

  it('非法 factor 当作 1，不会把克数变成 0 或 NaN', () => {
    expect(eatenGrams(100, 0)).toBe(100);
    expect(eatenGrams(100, NaN)).toBe(100);
    expect(eatenGrams(100, -1)).toBe(100);
  });
});

describe('wholeFromEaten：反解整份', () => {
  it('想让吃到 100g，一半则整份填 200g', () => {
    expect(wholeFromEaten(100, 0.5)).toBe(200);
  });

  it('反解后正解应回到原值（往返一致）', () => {
    const whole = wholeFromEaten(50, SHARE_FACTORS.third);
    expect(eatenGrams(whole, SHARE_FACTORS.third)).toBe(50);
  });
});

describe('shareNote 与默认档位', () => {
  it('全部不解释，其余给一句', () => {
    expect(shareNote('all')).toBeNull();
    expect(shareNote(null)).toBeNull();
    expect(shareNote('third')).toContain('三分之一');
  });

  it('默认档位能存能取；没存过是全部', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    try {
      expect(loadShareDefault()).toBe('all');
      saveShareDefault('half');
      expect(loadShareDefault()).toBe('half');
    } finally {
      if (orig) Object.defineProperty(globalThis, 'localStorage', orig);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('localStorage 抛异常时不崩（隐私模式）', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
      configurable: true,
    });
    try {
      expect(loadShareDefault()).toBe('all');
      expect(() => saveShareDefault('half')).not.toThrow();
    } finally {
      if (orig) Object.defineProperty(globalThis, 'localStorage', orig);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
