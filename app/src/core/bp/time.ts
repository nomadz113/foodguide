/**
 * 血压记录的时刻决策。
 *
 * 抽成纯函数只有一个理由：**这个决定会静默地错**。
 *
 * 归档日由 measuredAt 推算，所以时刻差一天，记录就落到另一个格子里 ——
 * 趋势图上它会表现为"某天突然出现一个离群点"，没人会怀疑是归档时间算错了。
 * 这类 bug 不可能靠肉眼 review 发现，只能靠锁死预期。
 *
 * 优先级：机器屏幕显示的时间 > 照片 EXIF > 文件名时间戳 > 文件修改时间 > 现在。
 *
 * 屏幕赢过 EXIF 是这里的判断核心：EXIF 代表的是**拍照时刻**，不是**测量时刻**。
 * 补录三天前的记录时两者相差三天，若按 EXIF 归档，那条记录会落在"今天"，
 * 于是历史趋势被人造地抹平。反过来，屏幕上的时间是机器自己打印的测量时刻，
 * 哪怕用户是今天才想起拍照。
 */

import { parseDisplayedAt } from '../ai/bpPrompt';
import type { TakenAtResult } from '../media/takenAt';
import type { BpTimeSource } from '../db/types';

export interface PickBpTimeResult {
  measuredAt: number;
  source: BpTimeSource;
}

/**
 * @param displayedAt 模型从屏幕上读到的时间字符串，可为 null
 * @param fallback    readPhotoTime 的兜底结果（已经走过 EXIF → 文件名 → mtime → now）
 */
export function pickBpTime(displayedAt: string | null, fallback: TakenAtResult): PickBpTimeResult {
  const raw = parseDisplayedAt(displayedAt, new Date(fallback.takenAt));
  const fromScreen = raw != null;
  const candidate = raw ?? fallback.takenAt;
  const source: BpTimeSource = fromScreen ? 'display' : fallback.source;

  // 未来时间在这里就被夹回来，而不是等到保存时才提示。
  // 理由在这个文件开头已经说过一遍但值得再说：归档日按 dayStartHour 切，
  // 未来的记录会落到明天，于是「最近一次」、达标率分母、趋势最新点全被它污染，
  // 而且事后看不出到底哪里不对。
  const measuredAt = clampFuture(candidate);
  if (measuredAt !== candidate) return { measuredAt, source: 'now' };
  return { measuredAt, source };
}

/**
 * 由时刻推归档日时的一个额外校验：不允许未来。
 *
 * 允许 1 小时余量（相机时钟偏快、时区）。超过就退回"现在" ——
 * 未来的记录会污染"最近一次"，进而污染达标率与趋势的最新点。
 */
export const MAX_FUTURE_SKEW_MS = 60 * 60_000;

export function clampFuture(measuredAt: number, now = Date.now()): number {
  return measuredAt > now + MAX_FUTURE_SKEW_MS ? now : measuredAt;
}
