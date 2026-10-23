/**
 * 应用级数据上下文。
 *
 * 为什么用 context 而不是每个页面各自 useLiveQuery：
 * 目标快照的 ensureGoal 会写库，若放在 liveQuery 里会因为写库触发重跑而死循环。
 * 所以档案/目标在 App 层算一次，页面只订阅只读表（meals / weights）。
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { GoalSnapshot, Profile, Settings } from '../core/db/types';
import { bootstrap, loadSettings, saveProfile } from '../core/db/repo';
import { dayKey } from '../core/date';

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

const FALLBACK_PROFILE: Profile = {
  id: 'me', sex: 'male', birthDate: '1996-04-18', heightCm: 175, weightKg: 78,
  bodyFatPct: null, waistCm: null, activityLevel: 'light', exerciseTypes: [],
  exerciseDaysPerWeek: 2, goalType: 'lose', targetWeightKg: 68, paceKgPerWeek: 0.5,
  specialStates: [], conditions: [], allergies: [], dietPrefs: [], updatedAt: 0,
};

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ profile: Profile; goal: GoalSnapshot; settings: Settings } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        // bootstrap 内部已处理「首次启动 / 再次启动」两种情况：
        // 灌种子库（幂等）、建默认档案（已存在则复用）、算目标（指纹未变则复用）
        // 必须先 bootstrap 再读 settings：ensureSeed 会在 bootstrap 里写回
        // seedVersion，顺序反了会拿到旧快照（设置页会显示成 0）
        const r = await bootstrap();
        const settings = await loadSettings();
        if (alive) setState({ profile: r.profile, goal: r.goal, settings });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void init();
    return () => { alive = false; };
  }, []);

  const applyProfile = useCallback(
    async (p: Profile) => {
      const day = state?.settings.dayStartHour != null
        ? dayKey(new Date(), state.settings.dayStartHour)
        : dayKey(new Date());
      const goal = await saveProfile(p, day);
      setState((prev) => (prev ? { ...prev, profile: p, goal } : prev));
    },
    [state?.settings.dayStartHour],
  );

  const applySettings = useCallback((s: Settings) => {
    setState((prev) => (prev ? { ...prev, settings: s } : prev));
  }, []);

  const value = useMemo<AppData | null>(() => {
    if (!state) return null;
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
          <div style={{ fontSize: 12 }}>{error}</div>
          <div style={{ fontSize: 11 }}>请关闭无痕模式或检查浏览器是否禁用了本地存储</div>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="app">
        <div className="main center">
          <div style={{ fontSize: 12.5 }}>
            <div style={{ textAlign: 'center' }}>正在准备本地数据…</div>
          </div>
        </div>
      </div>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData 必须在 AppDataProvider 内使用');
  return v;
}

export { FALLBACK_PROFILE };
