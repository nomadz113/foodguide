import { describe, expect, it } from 'vitest';
import {
  buildBpSeries, groupSizeFor, movingAverage, SERIES_MAX_POINTS, splitGaps,
} from './trend';

/**
 * 这些用例守的是「图上那条线到底代表什么」。
 * 一条折线的形状可以被无数种聚合方式画出来，但只有一种和用户脑子里的一致：
 * 没测的日子是空的，而不是被前后两次测量插值出来的。
 */

describe('groupSizeFor 聚合力度', () => {
  it('周/月窗口每天一个点', () => {
    expect(groupSizeFor(7)).toBe(1);
    expect(groupSizeFor(30)).toBe(1);
  });

  it('超过鲜 30 天改用 7 天一组', () => {
    expect(groupSizeFor(SERIES_MAX_POINTS)).toBe(1);
    expect(groupSizeFor(SERIES_MAX_POINTS + 1)).toBe(7);
    expect(groupSizeFor(90)).toBe(7);
  });
});

describe('buildBpSeries 序列', () => {
  const elapsed = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];

  it('没记录的日子保留点位但读数为 null —— 断点，不是零', () => {
    const pts = buildBpSeries(
      elapsed,
      [{ date: '2026-10-20', reading: { systolic: 120, diastolic: 80 } }],
      1,
    );
    expect(pts).toHaveLength(4);
    expect(pts[0]!.reading).toEqual({ systolic: 120, diastolic: 80 });
    expect(pts[1]!.reading).toBeNull();
    expect(pts[1]!.days).toBe(0);
  });

  it('x 轴序列完整，不代表所有天都有值', () => {
    const pts = buildBpSeries(elapsed, [], 1);
    expect(pts.map((p) => p.key)).toEqual(elapsed);
    expect(pts.every((p) => p.reading === null)).toBe(true);
  });

  it('组均值按「天」加权：一天测三次不会占三倍权重', () => {
    // 两天各一条 vs 一次合并 —— 天权重相等时结果就是两天读数中那一天的均值
    const pts = buildBpSeries(
      ['2026-10-20', '2026-10-21'],
      [
        { date: '2026-10-20', reading: { systolic: 120, diastolic: 80 } },
        { date: '2026-10-21', reading: { systolic: 130, diastolic: 86 } },
      ],
      7,
    );
    expect(pts).toHaveLength(1);
    expect(pts[0]!.reading).toEqual({ systolic: 125, diastolic: 83 });
    expect(pts[0]!.days).toBe(2);
  });

  it('7 天一组时从窗口末尾往前切，最后一组恒为最近 7 天', () => {
    const all: string[] = [];
    for (let i = 0; i < 90; i += 1) {
      const d = new Date(2026, 0, 1);
      d.setDate(d.getDate() + i);
      const m = `${d.getMonth() + 1}`.padStart(2, '0');
      const day2 = `${d.getDate()}`.padStart(2, '0');
      all.push(`${d.getFullYear()}-${m}-${day2}`);
    }
    const pts = buildBpSeries(all, [], 7);
    expect(pts).toHaveLength(13);
    expect(pts[pts.length - 1]!.to).toBe(all[89]);
    expect(pts[pts.length - 1]!.from).toBe(all[83]);
    // 第一组是剩下的零头
    expect(pts[0]!.from).toBe(all[0]);
  });
});

describe('movingAverage 移动平均', () => {
  const pts = buildBpSeries(
    ['a', 'b', 'c', 'd', 'e'],
    [
      { date: 'a', reading: { systolic: 120, diastolic: 80 } },
      { date: 'b', reading: { systolic: 130, diastolic: 84 } },
      { date: 'd', reading: { systolic: 140, diastolic: 90 } },
      { date: 'e', reading: { systolic: 150, diastolic: 94 } },
    ],
    1,
  );

  it('有效点不足 3 个不给值 —— 两个点取平均等于连线中点，是在制造数据', () => {
    const ma = movingAverage(pts, 7);
    expect(ma[0]).toBeNull();
    expect(ma[1]).toBeNull();
  });

  it('窗口内的有效点不足 3 个不下结论（不是把空缺当 0 平均掉）', () => {
    const ma = movingAverage(pts, 7);
    // 索引 2 是 'c'，它本身没有读数，窗口里只有 a、b 两个有效点 → 仍然为 null
    expect(ma[2]).toBeNull();
  });

  it('凑够 3 个有效点才给值，空缺日不拉低也不抬高', () => {
    const ma = movingAverage(pts, 7);
    // 索引 3（'d'）：窗口内 a/b/d 三个有效点，(120+130+140)/3 = 130
    expect(ma[3]).toEqual({ systolic: 130, diastolic: 85 });
    expect(ma[4]!.systolic).toBe(135); // (120+130+140+150)/4
  });
});

describe('splitGaps 断开', () => {
  it('按连续段切分，保留原始下标', () => {
    const segs = splitGaps<number>([1, null, 2, 3, null, 4]);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.pts).toEqual([{ i: 0, v: 1 }]);
    expect(segs[1]!.pts).toEqual([{ i: 2, v: 2 }, { i: 3, v: 3 }]);
    expect(segs[2]!.pts).toEqual([{ i: 5, v: 4 }]);
  });

  it('全空返回零段，全满返回一段', () => {
    expect(splitGaps<number>([null, null])).toHaveLength(0);
    expect(splitGaps<number>([1, 2])).toHaveLength(1);
  });
});
