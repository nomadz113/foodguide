/**
 * 图片压缩 —— 直接决定 token 成本与识别质量。
 *
 * 实测（qwen3-vl-plus）：1024px 长边的餐盘图约 2,600 输入 token。
 * 原图直传（4000px）会到 8,000+ token，成本翻三倍且识别精度并不提升——
 * 视觉模型内部也会切块，超过 1024 的细节基本是浪费。
 */

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  /** 是否做了缩放 */
  resized: boolean;
}

/** 长边上限。1024 是成本与精度的拐点，别随手改大 */
export const VISION_MAX_SIDE = 1024;
/** 0.82 是肉眼无差别的临界，再低盘面上番茄和辣椒会糊成一片 */
export const VISION_JPEG_QUALITY = 0.82;

async function decode(blob: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // from-image：按 EXIF 摆正。手机竖拍的饭照不加这个会躺倒，识别框全错
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { src: bmp, w: bmp.width, h: bmp.height, release: () => bmp.close() };
    } catch {
      /* 老内核不支持 options，走下面的 fallback */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片解码失败'));
      el.src = url;
    });
    return {
      src: img,
      w: img.naturalWidth,
      h: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

export async function compressForVision(
  blob: Blob,
  maxSide: number = VISION_MAX_SIDE,
  quality: number = VISION_JPEG_QUALITY,
): Promise<CompressResult> {
  const { src, w, h, release } = await decode(blob);
  try {
    const longest = Math.max(w, h);
    const scale = longest > maxSide ? maxSide / longest : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布上下文');
    // 透明图直接转 JPEG 会变黑底，先铺白
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, tw, th);

    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('压缩失败'))),
        'image/jpeg',
        quality,
      );
    });

    return { blob: out, width: tw, height: th, bytes: out.size, resized: scale < 1 };
  } finally {
    release();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('读取图片失败'));
    r.readAsDataURL(blob);
  });
}
