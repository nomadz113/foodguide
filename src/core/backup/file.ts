/**
 * 备份文件的落地与拾取。
 *
 * 浏览器里 `<a download>` 就够了，但 **Android WebView 不认 download 属性** ——
 * 点了没反应，也不会报错。所以在原生包里必须先写进缓存目录，再交给系统分享面板，
 * 由用户决定存到微信/网盘/本地。这条分支不是优化，是能不能用的问题。
 *
 * 导入反过来：`<input type="file">` 由 Capacitor 的 WebChromeClient 接管，
 * 会正常唤起系统文件选择器，两边共用一套代码。
 */

export type SaveResult = 'downloaded' | 'shared' | 'canceled' | 'failed';

export interface SaveOutcome {
  how: SaveResult;
  /** 失败原因：真机上只看到一句「导出失败」是没法排查的，必须把底层错误带出来 */
  detail?: string;
}

export async function saveTextFile(filename: string, text: string): Promise<SaveOutcome> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const r = await shareViaNative(filename, text);
      if (r.how !== 'failed') return r;
      // 系统分享面板没起来（FileProvider / 插件缺失都可能），退到浏览器的 Web Share
      const viaWeb = await shareViaWebApi(filename, text);
      return viaWeb.how === 'shared' ? viaWeb : r;
    }
  } catch {
    // 非 Capacitor 环境（纯浏览器）或动态导入失败 → 走浏览器下载
  }
  return downloadViaAnchor(filename, text);
}

/**
 * 安卓上的最后一道退路：系统分享面板调不起来时试浏览器的 Web Share。
 * 它不需要 FileProvider 配置（URI 由浏览器自己给），在多数国产 ROM 的 WebView 上也可用。
 */
async function shareViaWebApi(filename: string, text: string): Promise<SaveOutcome> {
  try {
    const file = new File([text], filename, { type: 'application/json' });
    const nav = navigator as Navigator & {
      canShare?: (d: { files?: File[] }) => boolean;
      share?: (d: { files?: File[]; title?: string }) => Promise<void>;
    };
    if (!nav.canShare?.({ files: [file] }) || !nav.share) return { how: 'failed' };
    await nav.share({ files: [file], title: '每日摄入备份' });
    return { how: 'shared' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { how: /cancel/i.test(msg) ? 'canceled' : 'failed', detail: msg };
  }
}

async function downloadViaAnchor(filename: string, text: string): Promise<SaveOutcome> {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    return { how: 'downloaded' };
  } catch (e) {
    return { how: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

async function shareViaNative(filename: string, text: string): Promise<SaveOutcome> {
  try {
    const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');

    // encoding 必须显式给：不传时插件把 data 当 **base64** 解码，
    // 拿 JSON 文本去解必然抛错 —— 表现就是「点了导出，立刻失败」。
    const written = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    await Share.share({
      title: '每日摄入备份',
      text: '每日摄入指南 · 数据备份',
      files: [written.uri],
      dialogTitle: '保存备份文件',
    });
    return { how: 'shared' };
  } catch (e) {
    // 用户取消分享面板会走到这里 —— 那是"没保存"，不能报成"导出失败"
    const msg = e instanceof Error ? e.message : String(e);
    return { how: /cancel/i.test(msg) ? 'canceled' : 'failed', detail: msg };
  }
}

/** 弹出系统文件选择器，返回文件文本；用户取消返回 null */
export function pickTextFile(accept = 'application/json,.json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      try {
        done(await file.text());
      } catch {
        done(null);
      }
    });

    // 用户点了取消：Chrome 系会触发 cancel 事件，老内核不会，所以还要兜底
    input.addEventListener('cancel', () => done(null));

    input.click();
  });
}
