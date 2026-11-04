import { describe, expect, it } from 'vitest';
import { parseBpDraft, parseDisplayedAt } from './bpPrompt';

describe('parseDisplayedAt', () => {
  const base = new Date(2026, 9, 26, 20, 15);

  it('完整的日期时间按本地时区解释', () => {
    const t = parseDisplayedAt('2026-10-23 08:12', base);
    expect(t).not.toBeNull();
    const d = new Date(t!);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 23, 8, 12]);
  });

  it('缺日期时用兜底那天，时间仍以屏幕为准', () => {
    const t = parseDisplayedAt('????-??-?? 08:12', base);
    const d = new Date(t!);
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([9, 26, 8]);
  });

  it('只缺日份也算缺日期，整段退到兜底日', () => {
    const t = parseDisplayedAt('2026-10-?? 08:12', base);
    const d = new Date(t!);
    expect([d.getMonth(), d.getDate()]).toEqual([9, 26]);
  });

  it('T 分隔、不带秒也能读', () => {
    expect(parseDisplayedAt('2026-10-23T08:12', base)).not.toBeNull();
  });

  it('空值/乱码/越界一律返回 null，交给下层兜底', () => {
    expect(parseDisplayedAt(null, base)).toBeNull();
    expect(parseDisplayedAt('', base)).toBeNull();
    expect(parseDisplayedAt('早上八点', base)).toBeNull();
    expect(parseDisplayedAt('2026-10-23 24:00', base)).toBeNull();
    expect(parseDisplayedAt('2026-10-23 08:60', base)).toBeNull();
  });

  it('EXIF 风格的 ":" 分隔日期（模型偶尔这么写）也一并接受', () => {
    // 模型把 "2026:10:23 08:12" 当成DateTimeOriginal 格式抄过来是常见的
    const t = parseDisplayedAt('2026:10:23 08:12', base);
    expect(t).not.toBeNull();
    expect(new Date(t!).getDate()).toBe(23);
  });
});

describe('parseBpDraft', () => {
  it('缺失字段退化成 null，而不是 undefined 或 0', () => {
    const d = parseBpDraft({});
    expect(d.systolic).toBeNull();
    expect(d.diastolic).toBeNull();
    expect(d.pulse).toBeNull();
    expect(d.unit).toBeNull();
    expect(d.found).toBe(false);
    expect(d.rawSegments).toEqual([]);
  });

  it('字符串数字也认（模型经常把数字加引号）', () => {
    const d = parseBpDraft({ systolic: '126', diastolic: '82', pulse: '74' });
    expect(d.systolic).toBe(126);
    expect(d.diastolic).toBe(82);
    expect(d.pulse).toBe(74);
  });

  it('单位大小写无关地归一化，认不出的单位留 null（由 guard 默认 mmHg）', () => {
    expect(parseBpDraft({ unit: 'kPa' }).unit).toBe('kPa');
    expect(parseBpDraft({ unit: 'KPA' }).unit).toBe('kPa');
    expect(parseBpDraft({ unit: 'mmHg' }).unit).toBe('mmHg');
    expect(parseBpDraft({ unit: '托' }).unit).toBeNull();
  });

  it('confidence 钳制到 0..1', () => {
    expect(parseBpDraft({ confidence: 5 }).confidence).toBe(1);
    expect(parseBpDraft({ confidence: -1 }).confidence).toBe(0);
    expect(parseBpDraft({ confidence: 'abc' }).confidence).toBeNull();
  });

  it('布尔三态：true / false / 不确定，不确定必须是 null 不是 false', () => {
    expect(parseBpDraft({ isAverage: true }).isAverage).toBe(true);
    expect(parseBpDraft({ isAverage: 'true' }).isAverage).toBe(true);
    expect(parseBpDraft({ isAverage: 'false' }).isAverage).toBe(false);
    expect(parseBpDraft({ isAverage: null }).isAverage).toBeNull();
  });

  it('rawSegments 截断到 12 条：这是回溯凭据，不是给模型写作文的地方', () => {
    const many = Array.from({ length: 40 }, (_, i) => String(i));
    expect(parseBpDraft({ rawSegments: many }).rawSegments).toHaveLength(12);
  });

  it('设备名限长，防止模型把整段说明书抄进来', () => {
    expect(parseBpDraft({ device: 'x'.repeat(200) }).device).toHaveLength(40);
  });

  it('found 只认真值，其余一律 false —— 防止把噪声当血压计', () => {
    expect(parseBpDraft({ found: true }).found).toBe(true);
    expect(parseBpDraft({ found: 'true' }).found).toBe(true);
    expect(parseBpDraft({ found: 'yes' }).found).toBe(false);
    expect(parseBpDraft({ found: 1 }).found).toBe(false);
  });
});
