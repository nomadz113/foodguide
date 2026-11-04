import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { requestPersistentStorage } from './native/storage';

/**
 * iOS「加到主屏」判据。
 *
 * `navigator.standalone` 只有 iOS 认，安卓永远是 undefined —— 这正好是我们要的分界：
 * 安卓的顶部让位由 MainActivity 给 WebView 加 margin 完成，网页端再垫一次就是双层留白。
 * iOS 主屏模式下 viewport-fit=cover + black-translucent 会让页面画到状态栏/刘海下面，
 * 网页层必须自己垫（见 index.css 里的 html.ios-standalone .app）。
 */
if ((navigator as Navigator & { standalone?: boolean }).standalone === true) {
  document.documentElement.classList.add('ios-standalone');
}

// 数据只在本机，先要一层「别被自动清掉」的保障（失败不影响启动）
requestPersistentStorage();

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// HashRouter：纯静态托管无需任何 rewrite 规则，刷新子路由不会 404，
// 将来用 Capacitor 打包 APK 时同样适用。
createRoot(el).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
