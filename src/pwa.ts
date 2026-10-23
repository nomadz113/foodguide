import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 注册 Service Worker，并把「有新版本」变成一个可见、可点的状态。
 *
 * 三条纪律：
 * 1. **只有离线版（内嵌 assets，`https://localhost`）不注册**：资源本来就在本地，
 *    再加一层缓存会和 `cap sync` 的整包替换互相打架，升级后可能还跑着旧 JS。
 *    **在线版（加载远端域名）必须注册**——它靠 SW 才拿到「断网也能打开」的能力。
 * 2. **不自动 skipWaiting**。用户可能正把份量调到一半，自动刷新会把草稿丢掉。
 * 3. **注册失败不阻塞使用**。离线首访或站点被墙都可能失败，功能照常，只是没有离线能力。
 */
export function usePwaUpdate() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  /** 只有用户点了更新才允许刷新，见 onControllerChange */
  const applyingRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (import.meta.env.DEV) return;
    // 离线版的内置服务器；在线版 hostname 是远端域名，会继续往下注册 SW
    if (window.location.protocol === 'https:' && window.location.hostname === 'localhost') return;

    let reloading = false;
    const onControllerChange = () => {
      // 首次访问也会触发 controllerchange（SW 装好后 clients.claim()）。
      // 只有用户主动点了「更新」才刷新，否则会白白多加载一次整页。
      if (!applyingRef.current || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    void navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        if (reg.waiting) {
          waitingRef.current = reg.waiting;
          setHasUpdate(true);
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // 有 controller 说明不是首装，这次装的是更新
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              waitingRef.current = installing;
              setHasUpdate(true);
            }
          });
        });
      })
      .catch(() => {
        /* 注册失败就算了，不影响正常使用 */
      });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    applyingRef.current = true;
    waitingRef.current?.postMessage('SKIP_WAITING');
    setHasUpdate(false);
    // controllerchange 会触发刷新；万一没触发，兜底 800ms 后自己刷
    window.setTimeout(() => window.location.reload(), 800);
  }, []);

  return { hasUpdate, applyUpdate };
}
