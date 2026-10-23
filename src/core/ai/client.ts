/**
 * 唯一网络出口 —— 全 App 只有这个文件碰外网。
 *
 * 两种模式：
 *  - direct：浏览器直连百炼（实测 CORS 放行），Key 存在本机 IndexedDB，仅自用
 *  - proxy ：打自家云函数 /api/ai/vision，Key 在云函数环境变量，可分享给他人
 *
 * 换模型、换供应商、加上限流都只改这里，页面层不动。
 */
import { VISION_SYSTEM_PROMPT, buildVisionUserText } from './prompt';
import { INTENT_SYSTEM_PROMPT, parseIntent as parseIntentJson, type Intent } from './intent';
import {
  ADVICE_SYSTEM_PROMPT, adviceAllowedNumbers, buildAdviceText, parseAdvice,
  type AdviceDoc, type AdvicePayload,
} from './advice';
import { ItemsStreamParser, extractJson } from './streamJson';
import { compressForVision, blobToDataUrl } from './image';
import {
  AiError,
  type AiConfig,
  type RawAiItem,
  type RecognitionDraft,
  type RecognitionUsage,
  type RecogniseEvent,
} from './types';

/** qwen3-vl-plus 官方价：输入 ¥1/百万 token，输出 ¥10/百万 token */
const PRICE_IN = 1 / 1_000_000;
const PRICE_OUT = 10 / 1_000_000;

const DEFAULT_TIMEOUT_MS = 90_000;

export interface RecogniseOptions {
  config: AiConfig;
  /** 附带文字上下文，如「这顿在食堂吃的」 */
  mealHint?: string | null;
  /** 用户主动补充的份量说明，如「这是我的饭量，偏大」 */
  portionHint?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 流式进度回调：条目陆续到达 */
  onEvent?: (e: RecogniseEvent) => void;
}

export interface RecogniseResult {
  draft: RecognitionDraft;
  usage: RecognitionUsage;
}

function endpoint(config: AiConfig): { url: string; headers: Record<string, string> } {
  if (config.mode === 'proxy') {
    return { url: '/api/ai/vision', headers: { 'Content-Type': 'application/json' } };
  }
  if (!config.apiKey) throw new AiError('no_key', '缺少 API Key');
  return {
    url: `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  };
}

function mapHttpError(status: number): AiError {
  if (status === 401 || status === 403) return new AiError('auth', 'API Key 无效', status);
  if (status === 429) return new AiError('rate_limit', '请求过于频繁', status);
  if (status === 402 || status === 451) return new AiError('quota', '额度不足', status);
  return new AiError('server', `服务返回 ${status}`, status);
}

/** 把模型输出规整成可用草稿：剔除无效项、钳制克数、补齐缺省 */
export function normaliseDraft(raw: Partial<RecognitionDraft>): RecognitionDraft {
  const items: RawAiItem[] = [];
  for (const it of raw.items ?? []) {
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    const g = Number(it.baseG);
    if (!name || !Number.isFinite(g) || g <= 0) continue;
    // 单条上限 2000g：超过基本是把"盘子+碗"当成食物了
    const baseG = Math.min(2000, Math.max(1, Math.round(g)));
    const p = it.per100g ?? {};
    const kcal = Number(p.kcal);
    if (!Number.isFinite(kcal) || kcal < 0) {
      // 没有热量就无法参与统计，整条丢弃比留个 0 更诚实
      continue;
    }
    items.push({
      ...it,
      name,
      baseG,
      confidence: typeof it.confidence === 'number' ? Math.min(1, Math.max(0, it.confidence)) : 0.6,
      per100g: p,
    });
  }
  return {
    scene: typeof raw.scene === 'string' ? raw.scene : '',
    reference: {
      detected: Boolean(raw.reference?.detected),
      objects: Array.isArray(raw.reference?.objects) ? raw.reference.objects.map(String) : [],
      note: typeof raw.reference?.note === 'string' ? raw.reference.note : '',
    },
    items,
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String).slice(0, 8) : [],
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
  };
}

export async function recogniseMeal(photo: Blob, opts: RecogniseOptions): Promise<RecogniseResult> {
  const { config, mealHint = null, portionHint = null, onEvent, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AiError('offline', '当前离线');
  }

  const { url, headers } = endpoint(config);

  onEvent?.({ type: 'status', text: '正在压缩图片…' });
  const img = await compressForVision(photo);
  const dataUrl = await blobToDataUrl(img.blob);

  onEvent?.({ type: 'status', text: '正在识别…' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AiError('timeout', '识别超时')), timeoutMs);
  const onOuterAbort = () => controller.abort(new AiError('aborted', '已取消'));
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const t0 = Date.now();
  const body = {
    model: config.model,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: buildVisionUserText({ mealHint, portionHint }) },
        ],
      },
    ],
  };

  try {
    let res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((e: unknown) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new AiError('network', e instanceof Error ? e.message : '网络错误');
    });

    // 部分模型/网关不支持 response_format，被拒时去掉重试一次
    if (res.status === 400) {
      const text = await res.clone().text();
      if (text.includes('response_format')) {
        const { response_format: _drop, ...rest } = body;
        void _drop;
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(rest),
          signal: controller.signal,
        });
      }
    }

    if (!res.ok) throw mapHttpError(res.status);
    if (!res.body) throw new AiError('server', '响应为空');

    const parser = new ItemsStreamParser();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sse = '';
    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let index = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sse += decoder.decode(value, { stream: true });

      const lines = sse.split('\n');
      sse = lines.pop() ?? '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk: {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (!delta) continue;
        content += delta;
        for (const item of parser.push(delta)) {
          if (item?.name && Number(item.baseG) > 0) {
            onEvent?.({ type: 'item', item, index: index++ });
          }
        }
      }
    }

    let parsed: Partial<RecognitionDraft>;
    try {
      parsed = extractJson<Partial<RecognitionDraft>>(content);
    } catch {
      throw new AiError('bad_json', '模型返回的不是合法 JSON');
    }

    const draft = normaliseDraft(parsed);
    if (draft.items.length === 0) {
      throw new AiError('bad_json', '没有识别出任何食物');
    }

    const usage: RecognitionUsage = {
      promptTokens,
      completionTokens,
      costCny: promptTokens * PRICE_IN + completionTokens * PRICE_OUT,
      ms: Date.now() - t0,
    };
    onEvent?.({ type: 'done', draft, usage });
    return { draft, usage };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (controller.signal.aborted) {
      const r = controller.signal.reason;
      throw r instanceof AiError ? r : new AiError('aborted', '已取消');
    }
    throw new AiError('network', e instanceof Error ? e.message : '未知错误');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

// ── 自然语言意图 ──────────────────────────────────────────

export interface IntentOptions {
  config: AiConfig;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 让模型知道"今天"是哪天，以及用户已有哪些自定义食物（用于 update/delete 指代） */
  today?: string;
  knownFoods?: string[];
}

export interface IntentResult {
  intent: Intent;
  usage: RecognitionUsage;
  /** 原始回复，排查用 */
  raw: string;
}

/**
 * 一句话 → 意图 JSON。
 * 非流式：输出只有几百 token，20 秒足够；流式反而让"卡片什么时候出现"变得不可预期。
 * 注意这里**不写库**，写库在用户点保存之后（§6.3）。
 */
export async function parseIntent(text: string, opts: IntentOptions): Promise<IntentResult> {
  const { config, timeoutMs = 25_000, today, knownFoods = [] } = opts;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AiError('offline', '当前离线');
  }
  const { url, headers } = endpoint(config);

  const ctx: string[] = [];
  if (today) ctx.push(`今天是 ${today}。`);
  if (knownFoods.length > 0) {
    ctx.push(`用户已建的自定义食物：${knownFoods.slice(0, 30).join('、')}。`);
  }
  const userText = ctx.length > 0 ? `${ctx.join('')}\n\n用户说：${text}` : `用户说：${text}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AiError('timeout', '解析超时')), timeoutMs);
  const onOuterAbort = () => controller.abort(new AiError('aborted', '已取消'));
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const t0 = Date.now();
  const body = {
    model: config.model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ],
  };

  try {
    let res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((e: unknown) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new AiError('network', e instanceof Error ? e.message : '网络错误');
    });

    if (res.status === 400) {
      const t = await res.clone().text();
      if (t.includes('response_format')) {
        const { response_format: _drop, ...rest } = body;
        void _drop;
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(rest),
          signal: controller.signal,
        });
      }
    }
    if (!res.ok) throw mapHttpError(res.status);

    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = j.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new AiError('bad_json', '模型没有返回内容');

    let raw: unknown;
    try {
      raw = extractJson<unknown>(content);
    } catch {
      throw new AiError('bad_json', '模型返回的不是合法 JSON');
    }

    const promptTokens = j.usage?.prompt_tokens ?? 0;
    const completionTokens = j.usage?.completion_tokens ?? 0;
    return {
      intent: parseIntentJson(raw),
      raw: content,
      usage: {
        promptTokens,
        completionTokens,
        // qwen-plus：输入 ¥0.8/百万、输出 ¥2/百万
        costCny: promptTokens * 0.8e-6 + completionTokens * 2e-6,
        ms: Date.now() - t0,
      },
    };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (controller.signal.aborted) {
      const r = controller.signal.reason;
      throw r instanceof AiError ? r : new AiError('aborted', '已取消');
    }
    throw new AiError('network', e instanceof Error ? e.message : '未知错误');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * 连通性自检：发一条 4 token 的小请求，验证 Key / 网络 / 模型名。
 * 不做视觉调用，成本可忽略（<¥0.001）。
 */
export async function testConnection(config: AiConfig, timeoutMs = 15_000): Promise<string> {
  if (config.mode === 'proxy') throw new AiError('server', '代理模式请在部署后于云端验证');
  const { url, headers } = endpoint(config);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        // 直接用配置里的模型：qwen3-vl-plus 接受纯文本请求（已验证），
        // 这样测的就是真正要用的那个模型，换任何模型名都不会测错
        model: config.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: '只回复 ok' }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw mapHttpError(res.status);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content?.trim() || 'ok';
  } catch (e) {
    if (ctrl.signal.aborted) throw new AiError('timeout', '连接超时');
    if (e instanceof AiError) throw e;
    throw new AiError('network', e instanceof Error ? e.message : '网络错误');
  } finally {
    clearTimeout(timer);
  }
}

// ── 每日建议叙述 ──────────────────────────────────────────

export interface AdviceOptions {
  config: AiConfig;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AdviceResult {
  doc: AdviceDoc;
  usage: RecognitionUsage;
}

/**
 * 把算好的数字交给模型叙述。
 *
 * 非流式：整段建议必须一次成型，流式会让「半句话」先出现在界面上。
 * 失败时调用方直接退回到本地规则建议（advice/local.ts），不弹错。
 */
export async function generateAdvice(
  payload: AdvicePayload,
  opts: AdviceOptions,
): Promise<AdviceResult> {
  const { config, timeoutMs = 30_000 } = opts;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AiError('offline', '当前离线');
  }
  const { url, headers } = endpoint(config);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AiError('timeout', '建议生成超时')), timeoutMs);
  const onOuterAbort = () => controller.abort(new AiError('aborted', '已取消'));
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const t0 = Date.now();
  const body = {
    model: config.model,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ADVICE_SYSTEM_PROMPT },
      { role: 'user', content: buildAdviceText(payload) },
    ],
  };

  try {
    let res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((e: unknown) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new AiError('network', e instanceof Error ? e.message : '网络错误');
    });

    if (res.status === 400) {
      const t = await res.clone().text();
      if (t.includes('response_format')) {
        const { response_format: _drop, ...rest } = body;
        void _drop;
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(rest),
          signal: controller.signal,
        });
      }
    }
    if (!res.ok) throw mapHttpError(res.status);

    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = j.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new AiError('bad_json', '模型没有返回内容');

    let raw: unknown;
    try {
      raw = extractJson<unknown>(content);
    } catch {
      throw new AiError('bad_json', '模型返回的不是合法 JSON');
    }

    let doc: AdviceDoc;
    try {
      doc = parseAdvice(raw, adviceAllowedNumbers(payload));
    } catch {
      throw new AiError('bad_json', '建议内容不完整');
    }

    const promptTokens = j.usage?.prompt_tokens ?? 0;
    const completionTokens = j.usage?.completion_tokens ?? 0;
    return {
      doc,
      usage: {
        promptTokens,
        completionTokens,
        // qwen-plus：输入 ¥0.8/百万、输出 ¥2/百万
        costCny: promptTokens * 0.8e-6 + completionTokens * 2e-6,
        ms: Date.now() - t0,
      },
    };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (controller.signal.aborted) {
      const r = controller.signal.reason;
      throw r instanceof AiError ? r : new AiError('aborted', '已取消');
    }
    throw new AiError('network', e instanceof Error ? e.message : '未知错误');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
