/**
 * 通知原生：第一帧已经画出来了，可以把启动层撤掉（插件 Splash）。
 *
 * 为什么必须由前端来发这个信号：只有这里知道「数据准备好了、页面真的画出来了」。
 * 原生最早能拿到的时机是 onPageFinished —— 那只是 HTML 下载完，
 * 距离 React 渲染、IndexedDB 打开、食物库播种完成还差好几百毫秒到几秒。
 * 早撤一步，用户就会看到「logo 消失、页面还是空的」。
 *
 * 浏览器 / 网页版没有这个原生层：Capacitor.isNativePlatform() 为 false，
 * 或者插件不存在（旧包里没这个类），两种都直接返回，不抛错。
 */
export function signalSplashReady(): void {
  // 动态 import：这一刻首帧已经画完了，多花几毫秒加载一个 chunk 无感，
  // 但绝不能把它塞进首屏同步链路里 —— 启动速度优先于这个信号的速度。
  void (async () => {
    try {
      const { Capacitor, registerPlugin } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const splash = registerPlugin<{ ready(): Promise<void> }>('Splash');
      await splash.ready();
    } catch {
      // 旧版本 APK / 浏览器：没有启动层，无事可做
    }
  })();
}
