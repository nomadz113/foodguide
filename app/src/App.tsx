import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { TabBar } from './ui/TabBar';
import { watchKeyboard } from './ui/keyboard';
import { AppDataProvider } from './store/AppData';
import { TodayPage } from './pages/Today';
import { useAndroidBack } from './native/back';
import { usePwaUpdate } from './pwa';
import { signalSplashReady } from './native/splash';
import { PageSkeleton } from './ui/Loading';

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
/** 库缺口清单：从设置页进，补「AI 认出来但库里没有」的名字 */
const MissesPage = lazy(() => import('./pages/MissesPage').then((m) => ({ default: m.MissesPage })));
/** 拍照与手填共用同一张确认表，差别只在初始是不是已经有一张照片 */
const BpCapturePage = lazy(() => import('./pages/BpCapture').then((m) => ({ default: m.BpCapturePage })));
/** 体脂秤 / Keep 截图录入体重与体脂率 */
const ScaleCapturePage = lazy(() => import('./pages/ScaleCapture').then((m) => ({ default: m.ScaleCapturePage })));

/** 带底部导航的页面壳。
 *
 * Suspense 边界**必须放在这一层**，只包 <Outlet />：
 * 包在 <Routes> 外面时，任何一个 lazy 页面首次加载（Stats 10.6KB / Settings 9.5KB /
 * Chat 7.6KB）都会让 Shell 整体卸载 —— 底栏跟着消失，再从「居中一句读取中」变回来。
 * 在线 wb 版 APK 每次冷启动都要重新下载，这条路径每天都会走到。
 */
function Shell() {
  return (
    <div className="app">
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
      <TabBar />
    </div>
  );
}

/**
 * 原生启动层的退场信号。
 *
 * 挂在 AppDataProvider 的 children 里，这是关键：Provider 在数据没准备好时
 * 根本不渲染 children（它自己有「正在准备本地数据…」）。所以本组件一挂载，
 * 就等于「bootstrap 完成、首页马上要画」。
 *
 * 再等两个 rAF：effect 跑在 commit 之后、绘制之前，第一帧还没上屏。
 * 两个 rAF 意味着中间至少有一帧真的画出去了，这时撤启动层才不会露出空白。
 * 顺序不能反：先撤层再画 = 又黑一下，等于白改。
 */
function SplashGate() {
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => signalSplashReady());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  return null;
}

export default function App() {
  useAndroidBack();
  const { hasUpdate, applyUpdate } = usePwaUpdate();

  // 全局开一次：键盘让位（--app-h）与输入框聚焦后的滚动守卫，
  // 所有页面的输入框都靠它，不用每个页面各装一遍
  useEffect(() => watchKeyboard(), []);

  return (
    <>
      {/* 必须在 AppDataProvider 外面：provider 在引导未完成时直接渲染 WelcomePage、
          children 不挂载，放里面的话首次启动永远收不到信号，原生启动屏不会消失 */}
      <SplashGate />
      <AppDataProvider>
        {hasUpdate && (
          <button className="updatechip" onClick={applyUpdate}>
            有新版本 · 点此更新
          </button>
        )}
        {/* 外层这一道只兜「Shell 本身都没渲染出来」的异常路径（比如路由配置出错）。
            正常情况下真正会闪的那一下已经被 Shell 内部的边界接住了，底栏不动。 */}
        <Suspense fallback={<div className="app"><PageSkeleton /></div>}>
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
              <Route path="/misses" element={<MissesPage />} />
              {/* 血压并进了「统计」栏目，与饮食用分区胶囊隔开。
                  旧路径保留成重定向：老书签、以及安卓上「最近任务」里的历史记录都还指着 /bp。 */}
              <Route path="/bp" element={<Navigate to="/stats?tab=bp" replace />} />
              <Route path="/bp/capture" element={<BpCapturePage />} />
              <Route
                path="/bp/manual"
                element={<BpCapturePage manual />}
              />
              {/* 从档案页的体重字段进来；保存后 replace 回 /profile */}
              <Route path="/scale" element={<ScaleCapturePage />} />
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
    </>
  );
}
