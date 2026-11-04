import { describe, expect, it } from 'vitest';
import { parseExifDate, parseFilenameTime, readExifTime, readPhotoTime } from './takenAt';

/**
 * 手工拼一张带 EXIF 的 JPEG。
 *
 * 为什么要自己拼而不 import export 一张图：这张图的每个字节都必须可控，
 * 才能分别验证「大端/小端」「有甚至 EXIF 子 IFD」「只有 DateTime」「APP1 装的是 XMP」这几种情况。
 * 真实世界这几种都见过，尤其是某些厂商只在 IFD0 写 DateTime —— 那是最后存盘时间，
 * 不能当拍摄时间用，必须有对应的用例把「优先取 DateTimeOriginal」这条规则压住。
 */
interface FixtureOpts {
  little?: boolean;
  /** IFD0 的 DateTime（0x0132） */
  ifd0?: string;
  /** ExifIFD 的 DateTimeOriginal（0x9003） */
  original?: string | null;
  /** 用非 Exif 的 APP1（例如 XMP）冒充 */
  app1Payload?: string;
}

function writeAscii(view: DataView, at: number, text: string, len: number): void {
  for (let i = 0; i < len; i++) view.setUint8(at + i, i < text.length ? text.charCodeAt(i) : 0);
}

function buildTiff({ little = true, ifd0 = '2026:10:26 08:12:34', original = '2026:10:26 08:12:34' }: FixtureOpts): Uint8Array {
  const buf = new ArrayBuffer(96);
  const view = new DataView(buf);
  const u16 = (o: number, v: number) => view.setUint16(o, v, little);
  const u32 = (o: number, v: number) => view.setUint32(o, v, little);

  view.setUint8(0, little ? 0x49 : 0x4d);
  view.setUint8(1, little ? 0x49 : 0x4d);
  u16(2, 42);
  u32(4, 8);

  u16(8, 2); // IFD0 两个条目
  u16(10, 0x0132); u16(12, 2); u32(14, 20); u32(18, 38); // DateTime → 偏移 38
  u16(22, 0x8769); u16(24, 4); u32(26, 1); u32(30, 78);  // ExifIFD 指针 → 78
  u32(34, 0); // 下一个 IFD：没有

  writeAscii(view, 38, ifd0, 20);
  writeAscii(view, 58, original ?? '', 20);

  if (original == null) {
    u16(78, 0); // 空的子 IFD：什么都没读到，应当回落到 IFD0 的 DateTime
  } else {
    u16(78, 1);
    u16(80, 0x9003); u16(82, 2); u32(84, 20); u32(88, 58);
    u32(92, 0);
  }
  return new Uint8Array(buf);
}

function buildJpeg(opts: FixtureOpts = {}): ArrayBuffer {
  const app1Body = opts.app1Payload
    ? new TextEncoder().encode(opts.app1Payload)
    : (() => {
      const body = new Uint8Array(6 + 96);
      body.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
      body.set(buildTiff(opts), 6);
      return body;
    })();

  const total = 2 + 2 + app1Body.length + 2 + 4;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe1);
  view.setUint16(4, 2 + app1Body.length);
  buf.set(app1Body, 6);
  view.setUint16(6 + app1Body.length, 0xffda);
  return buf.buffer;
}

describe('EXIF 解析', () => {
  it('取 DateTimeOriginal', () => {
    const r = readExifTime(buildJpeg({ original: '2026:10:26 08:12:34' }));
    expect(r?.takenAt).toBe(new Date(2026, 9, 26, 8, 12, 34).getTime());
  });

  it('大端字节序同样能读', () => {
    const r = readExifTime(buildJpeg({ little: false, original: '2026:10:26 08:12:34' }));
    expect(r?.takenAt).toBe(new Date(2026, 9, 26, 8, 12, 34).getTime());
  });

  it('DateTimeOriginal 优先于 IFD0 的 DateTime', () => {
    const jpeg = buildJpeg({ ifd0: '2026:11:30 23:59:59', original: '2026:10:26 08:12:34' });
    const r = readExifTime(jpeg);
    expect(r?.takenAt).toBe(new Date(2026, 9, 26, 8, 12, 34).getTime());
    expect(r?.raw).toBe('2026:10:26 08:12:34');
  });

  it('子 IFD 里没有 DateTimeOriginal 时回落到 DateTime', () => {
    const r = readExifTime(buildJpeg({ ifd0: '2026:11:30 08:00:00', original: null }));
    expect(r?.takenAt).toBe(new Date(2026, 10, 30, 8, 0, 0).getTime());
  });

  it('APP1 里装的是非 Exif 数据（XMP）时返回 null，而不是乱码日期', () => {
    expect(readExifTime(buildJpeg({ app1Payload: 'http://ns.adobe.com/xap/1.0/\0<?xpacket' }))).toBeNull();
  });

  it('不是 JPEG 直接返回 null', () => {
    expect(readExifTime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).buffer)).toBeNull();
  });

  it('太短的缓冲区不炸', () => {
    expect(readExifTime(new Uint8Array([0xff, 0xd8]).buffer)).toBeNull();
    expect(readExifTime(new ArrayBuffer(0))).toBeNull();
  });

  it('EXIF 日期串格式不对就拒绝', () => {
    expect(parseExifDate('2026-10-26 08:12:34')).toBeNull();
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate('2026:13:40 08:12:34')).toBeNull();
    expect(parseExifDate('随便一段字')).toBeNull();
  });
});

describe('文件名时间戳', () => {
  const expectNone = (name: string) => expect(parseFilenameTime(name)).toBeNull();

  it('各家相机的命名规范', () => {
    const want = new Date(2026, 9, 26, 8, 12, 34).getTime();
    expect(parseFilenameTime('IMG_20261026_081234.jpg')).toBe(want);
    expect(parseFilenameTime('PXL_20261026_081234.jpg')).toBe(want);
    expect(parseFilenameTime('Screenshot_2026-10-26-08-12-34.png')).toBe(want);
  });

  it('微信导出的毫秒时间戳', () => {
    expect(parseFilenameTime('mmexport1698307954000.jpg')).toBe(1698307954000);
    expect(parseFilenameTime('wx_camera_1698307954000.jpg')).toBe(1698307954000);
  });

  it('没有时间戳的文件名老老实实返回 null', () => {
    expectNone('photo.jpg');
    expectNone('血压记录 1.jpg');
    expectNone('屏幕截图.jpg');
  });

  it('月份 13、日期 40 这类数字不是日期', () => {
    expectNone('IMG_20261326_081234.jpg');
    expectNone('IMG_20261040_081234.jpg');
  });
});

describe('readPhotoTime 兜底链', () => {
  it('有 EXIF 就用 EXIF', async () => {
    const blob = new Blob([buildJpeg({ original: '2026:10:26 08:12:34' })], { type: 'image/jpeg' });
    const r = await readPhotoTime({ blob, name: 'IMG_20260101_000000.jpg', lastModified: 1 });
    expect(r.source).toBe('exif');
    expect(r.takenAt).toBe(new Date(2026, 9, 26, 8, 12, 34).getTime());
  });

  it('EXIF 被剥了就退到文件名', async () => {
    // 微信转发一次就把 APP1 去掉了，只剩文件名里的时间
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 0, 0, 0])], { type: 'image/jpeg' });
    const r = await readPhotoTime({ blob, name: 'IMG_20261026_081234.jpg' });
    expect(r.source).toBe('filename');
    expect(r.takenAt).toBe(new Date(2026, 9, 26, 8, 12, 34).getTime());
  });

  it('文件名也没有就用修改时间', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' });
    const mtime = Date.now() - 60_000;
    const r = await readPhotoTime({ blob, name: 'photo.jpg', lastModified: mtime });
    expect(r.source).toBe('mtime');
    expect(r.takenAt).toBe(mtime);
  });

  it('修改时间被改成未来（一次云端下载就会这样）时退回现在', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' });
    const future = Date.now() + 10 * 24 * 60 * 60 * 1000;
    const r = await readPhotoTime({ blob, name: 'photo.jpg', lastModified: future });
    expect(r.source).toBe('now');
  });

  it('什么都没有时退到现在，并如实标注来源', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: '' });
    const r = await readPhotoTime({ blob });
    expect(r.source).toBe('now');
    expect(Math.abs(r.takenAt - Date.now())).toBeLessThan(5_000);
  });
});
