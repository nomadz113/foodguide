/**
 * 申请「持久化存储」。
 *
 * 为什么需要：iOS / Safari 的 IndexedDB 是 best-effort —— 磁盘紧张时整个 origin 的
 * 数据会被一起清掉，而这个 app 的全部记录只存在本机。`persist()` 成功后，
 * 浏览器不能再自动清理，只有用户手动清站点数据才会删。
 *
 * 平台差异（决定了为什么写成现在这样）：
 * - WebKit 对 **加到主屏的 Web App** 倾向直接批准，且这类 app 本身就不受
 *   「7 天没访问就清」的 ITP 规则约束（它有自己的使用天数计数，打开即重置）；
 * - Chromium 按「用户有没有装机/常来」打分决定，可能拒绝；
 * - 两边都可能因为「不是用户手势触发」而打折扣，所以没批准时挂一次
 *   pointerdown 重试 —— 只挂一次，不做无限重试（申请本身不是关键路径，
 *   拒绝也不该影响任何功能）。
 *
 * 不支持该 API 的浏览器（老 Safari、部分 WebView）直接返回。
 */
export function requestPersistentStorage(): void {
  void (async () => {
    try {
      const s = navigator.storage;
      if (!s?.persist || !s.persisted) return;
      if (await s.persisted()) return;
      if (await s.persist()) return;

      const retry = () => {
        document.removeEventListener('pointerdown', retry, true);
        void s.persist?.().catch(() => undefined);
      };
      document.addEventListener('pointerdown', retry, { capture: true, passive: true });
    } catch {
      // 隐私模式 / 不支持：功能照常，只是没有这层保护
    }
  })();
}
