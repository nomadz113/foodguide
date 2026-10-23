/**
 * 相机可用性自检（原生插件 CameraProbe）。
 *
 * 为什么需要：`<input capture>` 能不能起相机，取决于 PackageManager 能否解析
 * ACTION_IMAGE_CAPTURE。解析不到时 Capacitor 会静默回退到文件选择器，
 * 前端完全无感知 —— 用户看到的就是「点拍照只弹相册」。
 *
 * Web 端返回 null（浏览器没有这个问题，input capture 由浏览器自己处理）。
 */
export interface CameraStatus {
  canCapture: boolean;
  cameraApps: number;
  handlers: string;
  sdk: number;
  manufacturer: string;
}

export async function probeCamera(): Promise<CameraStatus | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return null;

    const probe = registerPlugin<{ status(): Promise<CameraStatus> }>('CameraProbe');
    return await probe.status();
  } catch {
    return null;
  }
}
