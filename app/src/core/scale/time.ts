/**
 * 体脂秤截图的时刻决策。
 *
 * 血压那份（core/bp/time.ts）只需要处理「屏幕印了完整日期」这一种情况；
 * 体脂 App 的截图不一样：Keep 写的是「今天 08:12」「昨天」「3 天前」。
 *
 * 所以这里多一层：parseKeepTime 把相对表述换算成绝对时刻。
 * 换算的基准取 **fallback.takenAt（文件时间）而不是 Date.now()** ——
 * 「今天」指的是**看到这一屏的那一刻**，也就是截图时刻；
 * 一张三天前截的图今天才导入，它上面的「今天」是三天前的今天。
 * 用 Date.now() 作基准会把这张图整个平移到现在，趋势图上就会多出一个假点。
 */

import { parseKeepTimeParts } from '../ai/keepPrompt';
import { clampFuture } from '../bp/time';
import type { BpTimeSource } from '../db/types';
import type { TakenAtResult } from '../media/takenAt';

/** 与血压共用同一套来源枚举：display 表示"页面上印的时间"，比任何文件元数据都可信 */
export type ScaleTimeSource = BpTimeSource;

export interface PickScaleTimeResult {
  measuredAt: number;
  source: ScaleTimeSource;
  /**
   * 日期来自页面、时分借用了截图文件时间。
   * 界面必须如实说出来 —— 用户看到的 14:32 不是秤上印的，是截图时刻的时分。
   */
  clockFromFile: boolean;
}

/**
 * @param timeText 模型从页面上抄回来的时间**原文**，可为 null
 * @param fallback readPhotoTime 的兜底结果（已走过 EXIF → 文件名 → mtime → now）
 */
export function pickScaleTime(timeText: string | null, fallback: TakenAtResult): PickScaleTimeResult {
  const parts = parseKeepTimeParts(timeText, new Date(fallback.takenAt));

  // ① 页面上的日期认不出来（或压根没印时间）→ 整条退到文件时间
  if (parts.ms == null) {
    const candidate = fallback.takenAt;
    const measuredAt = clampFuture(candidate);
    return {
      measuredAt,
      source: measuredAt !== candidate ? 'now' : fallback.source,
      clockFromFile: false,
    };
  }

  // ② 页面印了「今天 08:12」这种完整时刻 → 以页面为准（模型抄回来的原文）
  if (parts.hasClock) {
    const measuredAt = clampFuture(parts.ms);
    return { measuredAt, source: measuredAt !== parts.ms ? 'now' : 'display', clockFromFile: false };
  }

  // ③ 页面只印了日期（「10月24日」「昨天」）→ 日期用页面的，时分借文件时间。
  //
  // 为什么不用 00:00：keepPrompt 的 makeTime 在缺时分时填 0，那只是占位符，
  // 不是"零点量的"。留着它会让趋势图上全是 0 点整的点，而且界面无从解释。
  // 为什么只借时分不借日期：日期是页面印的，最可信（补录历史截图时文件时间
  // 是"今天截图"，日期却是三天前）。只取「时」和「分」，日期一个字节都不动，
  // 所以再怎么借也不会把记录挪到别的日子。
  const d = new Date(parts.ms);
  const f = new Date(fallback.takenAt);
  d.setHours(f.getHours(), f.getMinutes(), 0, 0);
  const candidate = d.getTime();
  const measuredAt = clampFuture(candidate);

  return {
    measuredAt,
    // 夹回说明这组合落在未来，那一刻已不是页面印的日期，来源改标 now 更诚实
    source: measuredAt !== candidate ? 'now' : 'display',
    clockFromFile: measuredAt === candidate,
  };
}

/**
 * 这次测量该不该更新档案里的「当前体重」。
 *
 * 补录三天前的记录时不该改档案 —— 档案的 weightKg 是"现在多重"，不是"历史某天多重"。
 * 判错的后果是静默的：用户补录一条旧记录，主页的热量目标突然按三天前的体重重算，
 * 而界面上没有任何地方说得出是这次补录引起的。
 *
 * 日期是定长 YYYY-MM-DD，所以字符串比较等价于时间比较，不需要解析成 Date
 * （解析会引入时区问题，而这个函数被调用在保存路径上，错一次就把档案写歪了）。
 */
export function shouldSyncProfile(measureDay: string, latestDay: string | null): boolean {
  if (!latestDay) return true;
  return measureDay >= latestDay;
}
