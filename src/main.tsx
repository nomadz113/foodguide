import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';

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
