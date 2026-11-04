import { describe, expect, it } from 'vitest';
import { BP_SOURCE_LABEL, draftFlags, manualFlags, pickBpSource } from './entry';

describe('pickBpSource：这条数字到底是谁给的', () => {
  it('手动入口一律 manual', () => {
    expect(pickBpSource({ manual: true, recognised: true })).toBe('manual');
    expect(pickBpSource({ manual: true, recognised: false })).toBe('manual');
  });

  it('拍照识别成功 → photo', () => {
    expect(pickBpSource({ manual: false, recognised: true })).toBe('photo');
  });

  it('拍照但没认出来、数字是用户自己打的 → manual。不能让失败伪造成机器读数', () => {
    expect(pickBpSource({ manual: false, recognised: false })).toBe('manual');
  });

  it('三个来源都有中文名，列表和导出共用一个字典', () => {
    expect(Object.keys(BP_SOURCE_LABEL)).toEqual(['photo', 'manual', 'import']);
  });
});

describe('draftFlags：模型说的每一句话都要留痕，但 null ≠ false', () => {
  it('三个字段原样落盘', () => {
    expect(draftFlags({ irregular: true, isAverage: false, rawSegments: ['132/85', 'P 74'] })).toEqual({
      irregular: true,
      avg: false,
      raw: ['132/85', 'P 74'],
    });
  });

  it('模型没说 → null，不是 false。没识别到心律不齐图标 ≠ 心律整齐', () => {
    expect(draftFlags({ irregular: null, isAverage: null, rawSegments: [] }).irregular).toBeNull();
    expect(draftFlags({}).avg).toBeNull();
    expect(draftFlags({}).irregular).toBeNull();
  });

  it('类型不对的字段退化成 null，而不是崩掉整个录入', () => {
    expect(draftFlags({ irregular: 'true' as unknown as boolean }).irregular).toBeNull();
    expect(draftFlags({ isAverage: 1 as unknown as boolean }).avg).toBeNull();
  });

  it('rawSegments 封顶 12 条 —— 这是给医生看的回溯凭据，不是给模型写作文的地方', () => {
    const many = Array.from({ length: 40 }, (_, i) => String(i));
    expect(draftFlags({ rawSegments: many }).raw).toHaveLength(12);
    expect(draftFlags({ rawSegments: null }).raw).toEqual([]);
  });
});

describe('manualFlags', () => {
  it('手填记录显式写 null：没查过就是没查过', () => {
    expect(manualFlags()).toEqual({ irregular: null, avg: null, raw: [] });
  });
});
