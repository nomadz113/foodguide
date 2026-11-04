/**
 * 照片拍摄时间。
 *
 * 为什么要四级兜底，而不是直接读 EXIF：
 * EXIF 看着最权威，实际最脆弱 —— 微信转发一次就把它剥掉了，截图生成的 PNG 压根没有
 * APP1 段，云端备份下来的图也常被 reresolve 掉元数据。更麻烦的是失败方式是**静默的**：
 * 读不到就退回「现在」，用户补录三天前的血压会被归档到今天，趋势图从此失真，
 * 而没人看得出来错在哪。
 *
 * 所以每一条记录都要记住时间是**从哪来的**（timeSource），界面上如实标注，并且允许改。
 *
 * 优先级：EXIF DateTimeOriginal > 文件名里的时间戳 > 文件修改时间 > 现在。
 *
 * 「机器屏幕显示的时间」排在整条链之前（见 core/ai/bpPrompt.ts），因为它是唯一真正
 * 代表**测量时刻**的值；但它由模型读出来，不属于本文件，由调用方合入。
 */

import type { BpTimeSource } from '../db/types';

export type FileTimeSource = Extract<BpTimeSource, 'exif' | 'filename' | 'mtime' | 'now'>;

export interface TakenAtResult {
  takenAt: number;
  source: FileTimeSource;
  /** 溯源用：EXIF 原始字符串或命中的文件名 */
  raw?: string;
}

export interface PhotoInput {
  blob: Blob;
  /** 原始文件名（含扩展名）。File 自带，自己拼的 Blob 可能没有 */
  name?: string | null;
  /** File.lastModified。经由 exchanger 传来的 Blob 会丢失这个字段 */
  lastModified?: number | null;
}

export const TIME_SOURCE_LABEL: Record<BpTimeSource, string> = {
  display: '机器屏幕显示的时间',
  exif: '照片拍摄信息 EXIF',
  filename: '文件名里的时间戳',
  mtime: '文件修改时间（可能不准）',
  now: '没查到，按录入时刻算',
  user: '你自己改过',
};

/** EXIF 一定在最前面，读多了没用。128KB 留了很大余量（含厂商私有段） */
const EXIF_SCAN_BYTES = 131_072;
/** 早于 2000 年的照片当作读错 */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
/** 允许将来 24 小时，覆盖时区差异与相机时钟偏快 */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

// ── EXIF ─────────────────────────────────────────────────
const TIFF_TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
};

interface Ifd {
  little: boolean;
  tiffStart: number;
}

/** 读 IFD 里我们关心的几个 tag。返回 tag → 数值或字符串 */
function readIfd(view: DataView, ifdOffset: number, ctx: Ifd, want: Set<number>): Map<number, number | string> {
  const out = new Map<number, number | string>();
  if (ifdOffset + 2 > view.byteLength) return out;
  const count = view.getUint16(ifdOffset, ctx.little);
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, ctx.little);
    if (!want.has(tag)) continue;
    const type = view.getUint16(entry + 2, ctx.little);
    const n = view.getUint32(entry + 4, ctx.little);
    const size = (TIFF_TYPE_SIZE[type] ?? 0) * n;
    const field = entry + 8;
    const valueOffset = size > 4 ? ctx.tiffStart + view.getUint32(field, ctx.little) : field;
    if (size > 4 && (valueOffset < 0 || valueOffset + size > view.byteLength)) continue;

    if (type === 2) {
      let s = '';
      for (let k = 0; k < n; k++) {
        const c = view.getUint8(valueOffset + k);
        if (c === 0) break; // EXIF 日期串以 NUL 结尾，且可能有尾部空格
        s += String.fromCharCode(c);
      }
      out.set(tag, s.trim());
    } else if (type === 3) {
      out.set(tag, view.getUint16(field, ctx.little));
    } else if (type === 4) {
      out.set(tag, view.getUint32(field, ctx.little));
    }
  }
  return out;
}

/**
 * EXIF 的 DateTimeOriginal **不带时区**（很多相机只写本地时间，且不写 OffsetTimeOriginal）。
 * 这里按设备本地时区解释：误差最多是「这台设备的时区设置不对」带来的几小时，
 * 而把它当 UTC 解释会带来八小时的系统性偏移，后者更糟也更难发现。
 */
export function parseExifDate(raw: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return buildTs(y, mo, d, h, mi, s);
}

function buildTs(y: string, mo: string, d: string, h: string, mi: string, s: string): number | null {
  const Y = Number(y);
  const M = Number(mo);
  const D = Number(d);
  const H = Number(h);
  const Mi = Number(mi);
  const S = Number(s);
  if (M < 1 || M > 12 || D < 1 || D > 31) return null;
  if (H > 23 || Mi > 59 || S > 59) return null;
  // 用本地时区构造：EXIF 记的是拍摄者当地的墙钟时间，显示时也该是那几个数字
  const ts = new Date(Y, M - 1, D, H, Mi, S);
  const local = ts.getTime();
  if (!Number.isFinite(local) || local < MIN_PLAUSIBLE_MS) return null;
  return local;
}

/** 从 JPEG 二进制里取拍摄时间。返回 null 表示「这家伙没有可信的拍摄时间」，不是出错 */
export function readExifTime(buf: ArrayBuffer): { takenAt: number; raw: string } | null {
  const view = new DataView(buf);
  if (view.byteLength < 4) return null;
  if (view.getUint16(0) !== 0xffd8) return null; // 只认 JPEG

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    // 有些编码器会塞连续的 0xFF 填充，先跳过
    while (offset + 2 <= view.byteLength && view.getUint8(offset) === 0xff && view.getUint8(offset + 1) === 0xff) {
      offset += 1;
    }
    if (offset + 4 > view.byteLength) break;
    const marker = view.getUint16(offset);
    if (marker === 0xffda) break; // 压缩数据开始，元信息必定在此之前
    if ((marker & 0xff00) !== 0xff00) return null; // 结构已坏

    const size = view.getUint16(offset + 2);
    if (size < 2) return null;

    if (marker === 0xffe1) {
      const seg = offset + 4;
      if (seg + 6 <= view.byteLength && ascii(view, seg, 4) === 'Exif' && view.getUint16(seg + 4) === 0) {
        const res = readTiff(view, seg + 6);
        if (res) return res;
      }
      return null; // APP1 存在但不是 Exif（XMP 之类），继续扫也没有意义
    }

    offset += 2 + size;
  }
  return null;
}

function ascii(view: DataView, at: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(at + i));
  return s;
}

function readTiff(view: DataView, tiffStart: number): { takenAt: number; raw: string } | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const bo = view.getUint16(tiffStart);
  if (bo !== 0x4949 && bo !== 0x4d4d) return null;
  const little = bo === 0x4949;
  if (view.getUint16(tiffStart + 2, little) !== 42) return null;
  const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little);
  const ctx: Ifd = { little, tiffStart };

  const ifd0Entries = readIfd(view, ifd0, ctx, new Set([0x0132, 0x8769]));
  let best: { raw: string; takenAt: number } | null = null;

  // ExifIFD 里的 DateTimeOriginal 优先于 IFD0 的 DateTime —— 后者可能只是最后存盘时间
  const subOffset = ifd0Entries.get(0x8769);
  if (typeof subOffset === 'number') {
    const sub = readIfd(view, tiffStart + subOffset, ctx, new Set([0x9003, 0x9004]));
    for (const tag of [0x9003, 0x9004]) {
      const v = sub.get(tag);
      if (typeof v === 'string') {
        const t = parseExifDate(v);
        if (t != null) return { raw: v, takenAt: t };
      }
    }
  }

  const dt = ifd0Entries.get(0x0132);
  if (typeof dt === 'string') {
    const t = parseExifDate(dt);
    if (t != null) best = { raw: dt, takenAt: t };
  }
  return best;
}

// ── 文件名时间戳 ──────────────────────────────────────────
/**
 * 文件名里的时间戳。
 *
 * 每条模式都对应一个真实来源：微信导出的 mmexport 是毫秒时间戳，最准；
 * IMG_/PXL_ 是各家相机的命名规范；剩下的兜一个「14 位连写」的通用形式。
 * 通用形式的风险是把任何一串数字都当成日期，所以后面要做严格的取值校验与合理区间检查。
 */
export function parseFilenameTime(name: string): number | null {
  const upper = name.trim();

  const epoch = /mmexport(\d{13})|wx_camera_(\d{13})/i.exec(upper);
  if (epoch) {
    const ms = Number(epoch[1] ?? epoch[2]);
    if (Number.isFinite(ms) && ms > MIN_PLAUSIBLE_MS) return ms;
  }

  const m = /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[-_T ]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/.exec(upper);
  if (m) {
    const t = buildTs(m[1], m[2], m[3], m[4], m[5], m[6]);
    if (t != null) return t;
  }
  return null;
}

// ── 入口 ─────────────────────────────────────────────────
/**
 * 取照片时间。
 *
 * 越靠前的来源越可信，但**没有一档是无条件的**：
 * mtime 会因为一次拷贝或一次云端下载被改成「刚才」，
 * 所以要卡一道合理区间检查，宁可退回「现在」也不要产出一个错得更隐蔽的值。
 */
export async function readPhotoTime(input: PhotoInput): Promise<TakenAtResult> {
  const now = Date.now();

  try {
    const head = await input.blob.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
    const exif = readExifTime(head);
    if (exif) return { takenAt: exif.takenAt, source: 'exif', raw: exif.raw };
  } catch {
    /* slice/arrayBuffer 在个别环境会抛；读不到就往下走兜底链，不影响录入 */
  }

  if (input.name) {
    const byName = parseFilenameTime(input.name);
    if (byName != null && plausible(byName, now)) {
      return { takenAt: byName, source: 'filename', raw: input.name };
    }
  }

  const mtime = input.lastModified ?? (input.blob as File).lastModified;
  if (typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0 && plausible(mtime, now)) {
    return { takenAt: mtime, source: 'mtime' };
  }

  return { takenAt: now, source: 'now' };
}

function plausible(ts: number, now: number): boolean {
  return Number.isFinite(ts) && ts >= MIN_PLAUSIBLE_MS && ts <= now + FUTURE_SLACK_MS;
}
