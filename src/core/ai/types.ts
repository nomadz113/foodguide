import type { NutrientKey } from '../nutrition/types';

/** direct = 自用阶段前端直连；proxy = 云函数代理，Key 不在前端 */
export type AiMode = 'direct' | 'proxy';

export interface AiConfig {
  mode: AiMode;
  /** direct 模式用；proxy 模式下忽略 */
  apiKey: string;
  /** direct: https://dashscope.aliyuncs.com/compatible-mode/v1 ；proxy: 空（走同源 /api/ai/vision） */
  baseUrl: string;
  model: string;
}

/** 模型返回的单条食材（未经校验，字段是"可能有"） */
export interface RawAiItem {
  name?: string;
  dish?: string | null;
  kind?: string;
  cookMethod?: string | null;
  baseG?: number;
  rangeG?: number[] | null;
  quantity?: number | null;
  unit?: string | null;
  confidence?: number | null;
  per100g?: Partial<Record<NutrientKey, number | null>> | null;
  note?: string | null;
}

export interface RecognitionDraft {
  scene: string;
  reference: { detected: boolean; objects: string[]; note: string };
  items: RawAiItem[];
  assumptions: string[];
  confidence: number | null;
}

export interface RecognitionUsage {
  promptTokens: number;
  completionTokens: number;
  /** 人民币元，按 qwen3-vl-plus 官方价估算 */
  costCny: number;
  ms: number;
}

export type AiErrorCode =
  | 'no_key'
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'timeout'
  | 'network'
  | 'offline'
  | 'bad_json'
  | 'server'
  | 'aborted';

export class AiError extends Error {
  code: AiErrorCode;
  status: number | null;
  constructor(code: AiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

export const AI_ERROR_TEXT: Record<AiErrorCode, string> = {
  no_key: '还没有配置 API Key，去设置里填一个',
  auth: 'API Key 无效或已过期',
  rate_limit: '请求太频繁，等几秒再试',
  quota: '账户额度用完了',
  timeout: '识别超时，换个网络或稍后再试',
  network: '网络请求失败，检查一下网络',
  offline: '你现在处于离线状态',
  bad_json: '模型返回格式异常，请重试',
  server: '模型服务暂时不可用',
  aborted: '已取消',
};

/** 识别过程中的事件流 */
export type RecogniseEvent =
  | { type: 'status'; text: string }
  | { type: 'item'; item: RawAiItem; index: number }
  | { type: 'done'; draft: RecognitionDraft; usage: RecognitionUsage };

export const DEFAULT_AI_CONFIG: AiConfig = {
  mode: 'direct',
  apiKey: '',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3-vl-plus',
};
