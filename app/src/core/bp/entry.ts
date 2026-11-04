/**
 * 录入时的两个派生值：**来源** 与 **flags**。
 *
 * 单独拎成一个文件（而不是散在 BpCapture 里）是因为这两个东西决定了
 * 这条记录「值不值得信」，而不是它的值是多少 —— 它们会被趋势图、
 * 给医生的导出、备份合并反复用到，必须可单测。
 *
 * 两条原则：
 * 1. **source 描述数字的出处，不是这次交互的形态。**
 *    拍照识别失败后用户自己手打的一组数，来源是 manual —— 声称 photo 等于
 *    把没验证过的东西伪装成机器读出来的。
 * 2. **flags 一律允许为 null。** null = 模型没说，不等于「没有」。
 *    心律不齐图标没被识别出 ≠ 这次心律整齐；这个区别在就医时会说话。
 */

import type { BpEntry, BpFlags } from '../db/types';

/** 模型草稿里与 flags 有关的那部分（BpRawDraft 的子集）—— 避免 core 反向依赖 ai 层 */
export interface FlagSource {
  irregular?: boolean | null;
  isAverage?: boolean | null;
  rawSegments?: string[] | null;
}

export function draftFlags(d: FlagSource): BpFlags {
  return {
    irregular: typeof d.irregular === 'boolean' ? d.irregular : null,
    avg: typeof d.isAverage === 'boolean' ? d.isAverage : null,
    raw: Array.isArray(d.rawSegments) ? d.rawSegments.map(String).slice(0, 12) : [],
  };
}

/** 手填或其它无从查证的来源。刻意写全 null 而不是省掉，让"没查过"这件事显式存在 */
export function manualFlags(): BpFlags {
  return { irregular: null, avg: null, raw: [] };
}

/**
 * 这条记录的来源。
 *
 * @param manual 是否从「手动输入」入口进来的
 * @param recognised 有没有一次成功的识别把数字填进过表单
 */
export function pickBpSource(input: { manual: boolean; recognised: boolean }): BpEntry['source'] {
  if (input.manual) return 'manual';
  return input.recognised ? 'photo' : 'manual';
}

export const BP_SOURCE_LABEL: Record<BpEntry['source'], string> = {
  photo: '拍照识别',
  manual: '手动录入',
  import: '导入',
};
