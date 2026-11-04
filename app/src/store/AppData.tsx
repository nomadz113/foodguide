/**
 * 应用级数据上下文。
 *
 * 为什么用 context 而不是每个页面各自 useLiveQuery：
 * 目标快照的 ensureGoal 会写库，若放在 liveQuery 里会因为写库触发重跑而死循环。
 * 所以档案/目标在 App 层算一次，页面只订阅只读表（meals / weights）。
 *
 * 引导未完成时**不渲染 children**，而是渲染 WelcomePage。
 * 这样所有业务页面都可以继续假设「一定有真实档案和真实目标」，
 * 不必在几十处加 null 判断 —— 未完成状态只在这一个文件里被处理一次。
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { GoalSnapshot, Profile, Settings } from '../core/db/types';
import { bootstrap, completeOnboarding, loadSettings, saveProfile } from '../core/db/repo';
import { dayKey } from '../core/date';
import { watchTheme } from '../native/theme';
import { WelcomePage } from '../pages/WelcomePage';
import { PageSkeleton } from '../ui/Loading';

interface AppData {
  profile: Profile;
  goal: GoalSnapshot;
  settings: Settings;
  /** 当前「今天」（按 dayStartHour 切日） */
  today: string;
  applyProfile: (p: Profile) => Promise<void>;
  applySettings: (s: Settings) => void;
}

const Ctx = createContext<AppData | null>(null);

/**
 * 只有 `onboarded: true` 的那一支才带 goal。
 *
 * 不用「goal 可为 null」的单一类型：那会让每个取 goal 的页面都得判断一次，
 * 而它们在没有目标时本来就不该被挂载。用联合类型让 tsc 守住这条线。
 */
type Ready =
  | { onboarded: false; profile: Profile; settings: Settings }
  | { onboarded: true; profile: Profile; goal: GoalSnapshot; settings: Settings };

/**
 * 引导状态镜像。index.html 的首帧脚本读它来选骨架变体。
 *
 * 与 app.theme 同一个思路：首帧读不到 IndexedDB（异步），只能读 localStorage。
 * 镜像过期（用户清了 IndexedDB 但没清 localStorage）最坏结果是「今日骨架 → 引导页」，
 * 而两块骨架的页头位置相同，位移 ≤0。
 */
function mirrorOnboarded(v: boolean) {
  try {
    localStorage.setItem('app.onboarded', v ? '1' : '0');
  } catch {
    // 无痕模式 / 存储被禁：镜像只是首帧优化，失败不影响任何功能
  }
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 骨架至少展示到 ready 为 true。判据是三件事缺一不可：
   *   ① state !== null（bootstrap 与 loadSettings 都回了 —— 这是唯一正确的完成信号，
   *      不要换成 setTimeout 猜时间）；
   *   ② 两个 rAF（沿用 App.tsx 的 SplashGate 做法：保证真的有一帧画出去了，
   *      否则撤骨架那一刻会露白）；
   *   ③ 最短展示 160ms —— 低于 100ms 的骨架会被感知成「闪一下」，
   *      比不出骨架更让人不安。只延后骨架，不推迟数据。
   */
  const [ready, setReady] = useState(false);
  /** 4s 兜底：卓易通容器的 WebView 版本未知，IndexedDB 被卡住时不 reject 只永挂 */
  const [slow, setSlow] = useState(false);
  const [bootAt] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()));

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        // bootstrap 内部已处理「首次启动 / 再次启动 / 老版本迁移」三种情况：
        // 灌种子库（幂等）、判断引导是否完成、算目标（指纹未变则复用）
        // 必须先 bootstrap 再读 settings：ensureSeed 会在 bootstrap 里写回
        // seedVersion，顺序反了会拿到旧快照（设置页会显示成 0）
        const r = await bootstrap();
        const settings = await loadSettings();
        if (!alive) return;
        mirrorOnboarded(!!r.goal);
        setState(
          r.goal
            ? { onboarded: true, profile: r.profile, goal: r.goal, settings }
            : { onboarded: false, profile: r.profile, settings },
        );
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void init();
    return () => { alive = false; };
  }, []);

  // 完成判据的 ②③ 两条。单独一个 effect：state 到位后还要等至少 160ms + 两帧
  useEffect(() => {
    if (!state) return;
    const now = typeof performance === 'undefined' ? bootAt + 1000 : performance.now();
    const wait = Math.max(0, 160 - (now - bootAt));
    let a = 0;
    let b = 0;
    const t = setTimeout(() => {
      a = requestAnimationFrame(() => {
        b = requestAnimationFrame(() => setReady(true));
      });
    }, wait);
    return () => { clearTimeout(t); cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [state, bootAt]);

  // 主题：数据就绪后由这里接管。
  // 首帧之前是 index.html 的内联脚本在撑着（读 localStorage 镜像），避免深色闪白；
  // 那段脚本读不到 Dexie，所以真正的偏好要等 settings 到位再重算一次。
  // watchTheme 返回的清理函数会在 mode 变化 / 卸载时摘掉 matchMedia 监听。
  const themeMode = state?.settings.theme ?? 'system';
  useEffect(() => watchTheme(themeMode), [themeMode]);

  const applyProfile = useCallback(
    async (p: Profile) => {
      const day = state?.settings.dayStartHour != null
        ? dayKey(new Date(), state.settings.dayStartHour)
        : dayKey(new Date());
      const goal = await saveProfile(p, day);
      setState((prev) => (prev?.onboarded ? { ...prev, profile: p, goal } : prev));
    },
    [state?.settings.dayStartHour],
  );

  const applySettings = useCallback((s: Settings) => {
    setState((prev) => (prev ? { ...prev, settings: s } : prev));
  }, []);

  /**
   * 引导完成。这是占位档案变成真实档案的唯一时刻。
   *
   * 完成后再读一次 settings：引导页最后一步可能已经写了 API Key，
   * 而 state 里那份是 bootstrap 时读的旧值。
   */
  const finishOnboarding = useCallback(
    async (p: Profile) => {
      const day = state?.settings.dayStartHour != null
        ? dayKey(new Date(), state.settings.dayStartHour)
        : dayKey(new Date());
      const { profile, goal } = await completeOnboarding(p, day);
      const settings = await loadSettings();
      mirrorOnboarded(true);
      setState({ onboarded: true, profile, goal, settings });
    },
    [state?.settings.dayStartHour],
  );

  const value = useMemo<AppData | null>(() => {
    if (!state?.onboarded) return null;
    return {
      ...state,
      today: dayKey(new Date(), state.settings.dayStartHour),
      applyProfile,
      applySettings,
    };
  }, [state, applyProfile, applySettings]);

  if (error) {
    return (
      <div className="app">
        <div className="main center" style={{ flexDirection: 'column', gap: 8, textAlign: 'center' }}>
          <div>数据初始化失败</div>
          <div style={{ fontSize: 'var(--fs-caption)' }}>{error}</div>
          <div style={{ fontSize: 'var(--fs-caption)' }}>请关闭无痕模式或检查浏览器是否禁用了本地存储</div>
          <button className="sk-retry" onClick={() => window.location.reload()}>重试</button>
        </div>
      </div>
    );
  }

  // 唯一的一处等待语言：整屏骨架。以前这里是居中一句「正在准备本地数据…」，和
  // 分包加载的「读取中…」是两种说法、两种字号、两种位置，而且会前后脚出现。
  if (!state || !ready) {
    return (
      <div className="app">
        <PageSkeleton slow={slow} />
      </div>
    );
  }

  // 引导未完成：不挂载任何业务页面。
  //
  // 仍然套一层 .app —— 它是「整页根节点」的唯一约定（高度、flex 列、iOS 加到主屏
  // 后的顶栏让位都挂在它上面）。引导页自己再当一次整页根，等于让每个「首屏渲染了没」
  // 的检查、每处安全区适配都得分两种情况写；漏一处就是静默量错东西。
  if (!state.onboarded) {
    return (
      <div className="app">
        <WelcomePage initial={state.profile} onDone={finishOnboarding} />
      </div>
    );
  }

  return <Ctx.Provider value={value!}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData 必须在 AppDataProvider 内使用');
  return v;
}
