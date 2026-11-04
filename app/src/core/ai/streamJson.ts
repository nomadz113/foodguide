import type { RawAiItem } from './types';

/**
 * 增量解析 SSE 里流式到达的 JSON，把 `items` 数组里已经完整的对象逐个吐出。
 *
 * 为什么值得写这一坨：qwen3-vl-plus 输出 700~2000 token，按 ~40 tok/s 要 20~50 秒。
 * 等整个 JSON 收完再解析，用户就得盯着转圈 20 秒；边流边出，第一项大约 3 秒就能看到。
 *
 * 只做一件事：在 `"items": [ ... ]` 里按括号深度找完整的 `{...}` 并 parse。
 * 解析失败就跳过（可能是半个对象），不影响后续。
 */
export class ItemsStreamParser {
  private buf = '';
  private arrStart = -1;
  private scan = 0;
  private depth = 0;
  private inStr = false;
  private esc = false;
  private objStart = -1;
  private pending: RawAiItem[] = [];

  /** 喂一个 chunk，返回这一口新凑齐的条目（可能为空） */
  push(chunk: string): RawAiItem[] {
    this.buf += chunk;

    if (this.arrStart < 0) {
      const m = this.buf.search(/"items"\s*:\s*\[/);
      if (m < 0) return [];
      this.arrStart = this.buf.indexOf('[', m);
      this.scan = this.arrStart + 1;
      this.depth = 0;
    }

    for (; this.scan < this.buf.length; this.scan++) {
      const ch = this.buf.charAt(this.scan);

      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (ch === '\\') this.esc = true;
        else if (ch === '"') this.inStr = false;
        continue;
      }

      if (ch === '"') {
        this.inStr = true;
      } else if (ch === '{') {
        if (this.depth === 0) this.objStart = this.scan;
        this.depth++;
      } else if (ch === '}') {
        this.depth--;
        if (this.depth === 0 && this.objStart >= 0) {
          const raw = this.buf.slice(this.objStart, this.scan + 1);
          try {
            this.pending.push(JSON.parse(raw) as RawAiItem);
          } catch {
            /* 半个对象或非法 JSON，跳过 */
          }
          this.objStart = -1;
        }
      } else if (ch === ']' && this.depth === 0) {
        break;
      }
    }

    if (this.pending.length === 0) return [];
    const out = this.pending;
    this.pending = [];
    return out;
  }
}

/** 从任意文本里抠出 JSON 对象：兼容 ```json 围栏与前后废话 */
export function extractJson<T = unknown>(text: string): T {
  let s = String(text ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}
