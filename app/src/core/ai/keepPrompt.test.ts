import { describe, expect, it } from 'vitest';
import { parseKeepDraft, parseKeepTime, parseKeepTimeParts } from './keepPrompt';

describe('parseKeepTime', () => {
  // 固定"现在"：2026-10-27 周二 11:22（本地时区）
  const now = new Date(2026, 9, 27, 11, 22);

  const ymdhm = (t: number | null) => {
    if (t == null) return null;
    const d = new Date(t);
    return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
  };

  it('「今天 HH:mm」落到今天，时间以页面为准', () => {
    expect(ymdhm(parseKeepTime('今天 08:12', now))).toEqual([2026, 10, 27, 8, 12]);
    expect(ymdhm(parseKeepTime('今日 08:12', now))).toEqual([2026, 10, 27, 8, 12]);
  });

  it('「昨天 / 前天」各退一天、两天', () => {
    expect(ymdhm(parseKeepTime('昨天 21:30', now))).toEqual([2026, 10, 26, 21, 30]);
    expect(ymdhm(parseKeepTime('前天', now))).toEqual([2026, 10, 25, 0, 0]);
  });

  it('「N 天前」按 N 退', () => {
    expect(ymdhm(parseKeepTime('3 天前 07:00', now))).toEqual([2026, 10, 24, 7, 0]);
    expect(ymdhm(parseKeepTime('7天前', now))).toEqual([2026, 10, 20, 0, 0]);
  });

  it('跨月相对日：月初的「昨天」要能落到上个月', () => {
    const firstOfMonth = new Date(2026, 10, 1, 9, 0); // 11-01
    expect(ymdhm(parseKeepTime('昨天 22:10', firstOfMonth))).toEqual([2026, 10, 31, 22, 10]);
  });

  it('「M月D日」补今年', () => {
    expect(ymdhm(parseKeepTime('10月24日 07:35', now))).toEqual([2026, 10, 24, 7, 35]);
  });

  it('算出未来时退到去年（12 月记录不该出现在 10 月）', () => {
    expect(ymdhm(parseKeepTime('12月03日 08:00', now))).toEqual([2025, 12, 3, 8, 0]);
  });

  it('完整日期直接采用，也接受 / 与 EXIF 式冒号分隔', () => {
    expect(ymdhm(parseKeepTime('2026-10-24 08:12', now))).toEqual([2026, 10, 24, 8, 12]);
    expect(ymdhm(parseKeepTime('2026/10/24 08:12', now))).toEqual([2026, 10, 24, 8, 12]);
    expect(ymdhm(parseKeepTime('2026:10:24 08:12', now))).toEqual([2026, 10, 24, 8, 12]);
    expect(ymdhm(parseKeepTime('2026年10月24日 08:12', now))).toEqual([2026, 10, 24, 8, 12]);
  });

  it('只有时间不猜：返回 null 让上层退到文件时间', () => {
    // 08:12 到底是今天还是昨天，只有用户知道。猜错会让记录落到错误的归档日。
    expect(parseKeepTime('08:12', now)).toBeNull();
    expect(parseKeepTime('刚刚', now)).not.toBeNull(); // 「刚刚」等价今天
  });

  it('认不出来的一律 null，不抛错', () => {
    expect(parseKeepTime(null, now)).toBeNull();
    expect(parseKeepTime('', now)).toBeNull();
    expect(parseKeepTime('上周', now)).toBeNull();
    expect(parseKeepTime('昨天 25:00', now)).not.toBeNull(); // 时间非法时退成当天 00:00
  });

  it('不存在的日期（2 月 30 日）返回 null，不让 Date 自动进位', () => {
    expect(parseKeepTime('2月30日', now)).toBeNull();
  });
});

describe('parseKeepDraft', () => {
  it('缺失字段退化成 null，而不是 undefined 或 0', () => {
    const d = parseKeepDraft({});
    expect(d.weight).toBeNull();
    expect(d.bodyFatPct).toBeNull();
    expect(d.unit).toBeNull();
    expect(d.timeText).toBeNull();
    expect(d.found).toBe(false);
    expect(d.rawSegments).toEqual([]);
  });

  it('字符串数字、逗号小数点、带单位的写法都能读', () => {
    expect(parseKeepDraft({ weight: '72.4' }).weight).toBe(72.4);
    expect(parseKeepDraft({ weight: '72,4' }).weight).toBe(72.4);
    expect(parseKeepDraft({ weight: '72.4 kg' }).weight).toBe(72.4);
    expect(parseKeepDraft({ bodyFatPct: '22.8%' }).bodyFatPct).toBe(22.8);
    expect(parseKeepDraft({ bodyFatPct: '22.8％' }).bodyFatPct).toBe(22.8);
  });

  it('空串和破折号是「没有数据」，必须是 null —— Number("") 是 0，这里是真正的坑', () => {
    expect(parseKeepDraft({ weight: '' }).weight).toBeNull();
    expect(parseKeepDraft({ weight: '--' }).weight).toBeNull();
    expect(parseKeepDraft({ bodyFatPct: '—' }).bodyFatPct).toBeNull();
    expect(parseKeepDraft({ bodyFatPct: 'Err' }).bodyFatPct).toBeNull();
    expect(parseKeepDraft({ bodyFatPct: 'N/A' }).bodyFatPct).toBeNull();
  });

  it('真正的 0 要保留为 0，与「没有数据」区分开（0 是否合法由 guard 判）', () => {
    expect(parseKeepDraft({ bodyFatPct: '0' }).bodyFatPct).toBe(0);
    expect(parseKeepDraft({ bodyFatPct: 0 }).bodyFatPct).toBe(0);
  });

  it('单位大小写无关地归一化；认不出的单位留 null，不默认成 kg', () => {
    expect(parseKeepDraft({ unit: 'kg' }).unit).toBe('kg');
    expect(parseKeepDraft({ unit: 'KG' }).unit).toBe('kg');
    expect(parseKeepDraft({ unit: 'LB' }).unit).toBe('lb');
    expect(parseKeepDraft({ unit: '斤' }).unit).toBeNull();
    expect(parseKeepDraft({ unit: '' }).unit).toBeNull();
  });

  it('布尔三态：平均值这件事不确定必须是 null 不是 false', () => {
    expect(parseKeepDraft({ isAggregate: true }).isAggregate).toBe(true);
    expect(parseKeepDraft({ isAggregate: 'false' }).isAggregate).toBe(false);
    expect(parseKeepDraft({ isAggregate: null }).isAggregate).toBeNull();
  });

  it('timeText 只做去空白和限长，绝不改写内容', () => {
    expect(parseKeepDraft({ timeText: '  今天 08:12 ' }).timeText).toBe('今天 08:12');
    expect(parseKeepDraft({ timeText: 'x'.repeat(200) }).timeText).toHaveLength(40);
    expect(parseKeepDraft({ timeText: '' }).timeText).toBeNull();
  });

  it('confidence 钳制到 0..1', () => {
    expect(parseKeepDraft({ confidence: 5 }).confidence).toBe(1);
    expect(parseKeepDraft({ confidence: -1 }).confidence).toBe(0);
    expect(parseKeepDraft({ confidence: 'abc' }).confidence).toBeNull();
  });

  it('rawSegments 截断到 12 条：这是回溯凭据，不是给模型写作文的地方', () => {
    const many = Array.from({ length: 40 }, (_, i) => String(i));
    expect(parseKeepDraft({ rawSegments: many }).rawSegments).toHaveLength(12);
  });

  it('found 只认真值，防止把聊天页/课程页当成体重记录', () => {
    expect(parseKeepDraft({ found: true }).found).toBe(true);
    expect(parseKeepDraft({ found: 'true' }).found).toBe(true);
    expect(parseKeepDraft({ found: 'yes' }).found).toBe(false);
    expect(parseKeepDraft({ found: 1 }).found).toBe(false);
  });
});

/**
 * hasClock 决定上层要不要拿截图时间补时分。
 * 判错的两种后果都很脏：判成 true → 记录留在 00:00（用户报的那个 bug）；
 * 判成 false → 把页面明明印着的 07:35 覆盖成截图时刻。
 */
describe('parseKeepTimeParts · 到底有没有时分', () => {
  const now = new Date(2026, 9, 27, 11, 22);

  it('带 HH:mm 时为 true', () => {
    expect(parseKeepTimeParts('今天 08:12', now).hasClock).toBe(true);
    expect(parseKeepTimeParts('2026-10-24 07:35', now).hasClock).toBe(true);
    expect(parseKeepTimeParts('10月24日 21:05', now).hasClock).toBe(true);
  });

  it('只有日期时为 false，并且 ms 的时分确实是占位的 0', () => {
    const p = parseKeepTimeParts('10月24日', now);
    expect(p.hasClock).toBe(false);
    expect(p.ms).not.toBeNull();
    expect(new Date(p.ms as number).getHours()).toBe(0);
  });

  it('「昨天」「刚才」「3 天前」没带时分，也算 false', () => {
    expect(parseKeepTimeParts('昨天', now).hasClock).toBe(false);
    expect(parseKeepTimeParts('刚才', now).hasClock).toBe(false);
    expect(parseKeepTimeParts('3 天前', now).hasClock).toBe(false);
  });

  it('日期认不出时 ms 为 null，不能拿 hasClock 去补救', () => {
    expect(parseKeepTimeParts('上周', now)).toEqual({ ms: null, hasClock: false });
    // 只有时间没有日期：日归属不明，整条退给上层兜底
    expect(parseKeepTimeParts('08:12', now)).toEqual({ ms: null, hasClock: false });
    expect(parseKeepTimeParts(null, now)).toEqual({ ms: null, hasClock: false });
  });

  it('EXIF 式 "2026:10:24" 里的 26:10 是日期，不是 26 点', () => {
    const p = parseKeepTimeParts('2026:10:24', now);
    expect(p.hasClock).toBe(false);
    expect(new Date(p.ms as number).getHours()).toBe(0);
  });
});
