import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { TabBar } from './ui/TabBar';
import { watchKeyboard } from './ui/keyboard';
import { AppDataProvider } from './store/AppData';
import { TodayPage } from './pages/Today';
import { useAndroidBack } from './native/back';
import { usePwaUpdate } from './pwa';

/**
 * 按路由拆包。
 *
 * 首屏只留今日页 —— 那是 90% 的打开场景。识别页、聊天页、进度页、档案页各自成块，
 * 用到才下载。这不是为了跑分：手机上首屏 190KB gzip 和 140KB 的差别是「点开就看」和「等一下」。
 * 今日页依赖的只有食物库与目标引擎，本来就不该拖上识别与报告。
 */
const AddMealPage = lazy(() => import('./pages/AddMeal').then((m) => ({ default: m.AddMealPage })));
const MealEditPage = lazy(() => import('./pages/MealEdit').then((m) => ({ default: m.MealEditPage })));
const CapturePage = lazy(() => import('./pages/CapturePage').then((m) => ({ default: m.CapturePage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

/** 带底部导航的页面壳 */
function Shell() {
  return (
    <div className="app">
      <Outlet />
      <TabBar />
    </div>
  );
}

/** 分包加载时的占位：保持与页面同色，避免白闪 */
function PageFallback() {
  return (
    <div className="app">
      <div className="main center">
        <div style={{ fontSize: 12.5, color: 'var(--mute)' }}>读取中…</div>
      </div>
    </div>
  );
}

export default function App() {
  useAndroidBack();
  const { hasUpdate, applyUpdate } = usePwaUpdate();

  // 全局开一次：键盘让位（--app-h）与输入框聚焦后的滚动守卫，
  // 所有页面的输入框都靠它，不用每个页面各装一遍
  useEffect(() => watchKeyboard(), []);

  return (
    <AppDataProvider>
      {hasUpdate && (
        <button className="updatechip" onClick={applyUpdate}>
          有新版本 · 点此更新
        </button>
      )}
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* 所有主页面都在 Shell 里 —— 底部导航必须常驻。
              之前 /chat、/capture、/add 挂在 Shell 外面，进去就没有导航也没有返回键，
              在 PWA 全屏下等于把自己关进了死胡同。 */}
          <Route element={<Shell />}>
            <Route path="/" element={<TodayPage />} />
            <Route path="/meal/:id" element={<MealEditPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/capture" element={<CapturePage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          {/* 手动记账页保留（不占导航位）：从拍照页底部一行小字进，
              页面自己的「取消」负责返回。 */}
          <Route path="/add" element={<AddMealPage />} />
          {/* 旧的「+」入口指向 /add，外部链接/书签进来时直接转拍照 */}
          <Route path="/record" element={<Navigate to="/capture" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppDataProvider>
  );
}
