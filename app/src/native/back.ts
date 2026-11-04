import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * 接管安卓物理返回键 / 手势返回。
 *
 * Capacitor 默认行为是「没有监听器就直接退出应用」——装到手机上按一下返回，
 * App 就没了。这里改成按浏览器历史退一步；已经在根页面才退出。
 *
 * 用动态 import：Web 端（PWA / 开发服务器）跑起来时不会把插件代码打进首屏。
 */
export function useAndroidBack() {
  const nav = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;

    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;

      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', () => {
        if (pathname === '/') {
          void App.exitApp();
          return;
        }
        // HashRouter 把历史深度记在 history.state.idx；直接冷启动某个子路由时是 0，
        // 这时退一步等于退出应用，所以显式回首页。
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) nav(-1);
        else nav('/');
      });

      if (alive) dispose = () => void handle.remove();
      else void handle.remove();
    })();

    return () => {
      alive = false;
      dispose?.();
    };
  }, [pathname, nav]);
}
