import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityLevel, ExerciseType, GoalType, Profile } from '../core/db/types';
import {
  ACTIVITY_LABELS, ageYears, bmi, buildGoalSnapshot, projectedWeeks, validateProfile,
} from '../core/goal/engine';
import { upsertWeight } from '../core/db/repo';
import { useAppData } from '../store/AppData';
import { NumInput } from '../ui/NumInput';

const GOALS: { key: GoalType; label: string }[] = [
  { key: 'lose', label: '减脂' },
  { key: 'maintain', label: '维持' },
  { key: 'gain', label: '增肌' },
  { key: 'health', label: '健康改善' },
];

const EXERCISES: { key: ExerciseType; label: string }[] = [
  { key: 'strength', label: '力量训练' },
  { key: 'cardio', label: '有氧' },
  { key: 'hiit', label: 'HIIT' },
];

const PACE_OPTIONS = [0.25, 0.5, 0.75, 1];

/**
 * 必填数字：删空时**保留上一个有效值**（档案里不留 null），
 * 输入框由 NumInput 自己显示为空串 —— 这样最后一位才删得掉。
 */
function required(patch: (v: number) => void) {
  return (v: number | null) => {
    if (v != null) patch(v);
  };
}

export function ProfilePage() {
  const { profile, today, applyProfile } = useAppData();
  const nav = useNavigate();

  const [draft, setDraft] = useState<Profile>(profile);
  const [saved, setSaved] = useState(false);

  function patch<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft((p) => ({ ...p, [key]: value }));
    setSaved(false);
  }

  const { goal, issues, bmiRes, age, weeks } = useMemo(() => {
    const list = validateProfile(draft);
    const snap = buildGoalSnapshot(draft, { from: today });
    return {
      goal: snap,
      issues: list,
      bmiRes: bmi(draft.weightKg, draft.heightCm),
      age: ageYears(draft.birthDate),
      weeks: projectedWeeks(snap.projectedDays),
    };
  }, [draft, today]);

  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const blocked = errors.length > 0;

  async function save() {
    if (blocked) return;
    await applyProfile(draft);
    await upsertWeight(today, draft.weightKg, draft.bodyFatPct);
    setSaved(true);
  }

  return (
    <>
      <div className="hdr">
        <div>
          <h1>个人档案</h1>
          <div className="sub">{age} 岁 · {ACTIVITY_LABELS[draft.activityLevel]} · 数据只存在本机</div>
        </div>
        <span className="pill">{bmiRes.value.toFixed(1)} · {bmiRes.label}</span>
      </div>

      <div className="main">
        <div className="seg">
          {(['male', 'female'] as const).map((s) => (
            <button key={s} className={draft.sex === s ? 'on' : ''} onClick={() => patch('sex', s)}>
              {s === 'male' ? '男' : '女'}
            </button>
          ))}
        </div>

        <div className="grid c3" style={{ marginTop: 10 }}>
          <label className="field">
            <span>出生日期</span>
            <input type="date" value={draft.birthDate} onChange={(e) => patch('birthDate', e.target.value)} />
          </label>
          <label className="field">
            <span>身高 cm</span>
            <NumInput value={draft.heightCm} onValue={required((v) => patch('heightCm', v))} />
          </label>
          <label className="field">
            <span>体重 kg</span>
            <NumInput value={draft.weightKg} onValue={required((v) => patch('weightKg', v))} />
          </label>
        </div>

        <div className="grid" style={{ marginTop: 9 }}>
          <label className="field">
            <span>体脂率 % · 可留空</span>
            <NumInput
              placeholder="留空用公式"
              value={draft.bodyFatPct}
              onValue={(v) => patch('bodyFatPct', v)}
            />
          </label>
          <label className="field">
            <span>腰围 cm · 可留空</span>
            <NumInput
              placeholder="可选"
              value={draft.waistCm}
              onValue={(v) => patch('waistCm', v)}
            />
          </label>
        </div>

        <div className="flabel">活动水平</div>
        <label className="field">
          <span>日常活动（不含专门运动）</span>
          <select
            value={draft.activityLevel}
            onChange={(e) => patch('activityLevel', e.target.value as ActivityLevel)}
          >
            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
              <option key={k} value={k}>{ACTIVITY_LABELS[k]} · ×{k === 'sedentary' ? '1.2' : k === 'light' ? '1.375' : k === 'moderate' ? '1.55' : k === 'active' ? '1.725' : '1.9'}</option>
            ))}
          </select>
        </label>

        <div className="flabel">运动类型（影响蛋白系数）</div>
        <div className="suggest" style={{ marginTop: 0 }}>
          {EXERCISES.map((e) => {
            const on = draft.exerciseTypes.includes(e.key);
            return (
              <button
                key={e.key}
                className={on ? 'on' : ''}
                style={on ? { borderColor: 'rgba(74,222,128,.5)', color: '#8fe6b0', background: 'rgba(74,222,128,.1)' } : undefined}
                onClick={() =>
                  patch(
                    'exerciseTypes',
                    on ? draft.exerciseTypes.filter((x) => x !== e.key) : [...draft.exerciseTypes, e.key],
                  )
                }
              >
                {e.label}
              </button>
            );
          })}
        </div>

        <div className="flabel">目标</div>
        <div className="seg">
          {GOALS.map((g) => (
            <button key={g.key} className={draft.goalType === g.key ? 'on' : ''} onClick={() => patch('goalType', g.key)}>
              {g.label}
            </button>
          ))}
        </div>

        {(draft.goalType === 'lose' || draft.goalType === 'gain') && (
          <div className="grid" style={{ marginTop: 9 }}>
            <label className="field">
              <span>目标体重 kg</span>
              <NumInput
                value={draft.targetWeightKg}
                onValue={(v) => patch('targetWeightKg', v)}
              />
            </label>
            <label className="field">
              <span>速度 kg / 周</span>
              <select
                value={String(draft.paceKgPerWeek ?? 0.5)}
                onChange={(e) => patch('paceKgPerWeek', Number(e.target.value))}
              >
                {PACE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}{p === 0.5 ? '（推荐）' : p === 1 ? '（激进）' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {errors.map((i) => (
          <div key={i.code} className="alert error"><span className="ic">✕</span><span>{i.message}</span></div>
        ))}
        {warns.map((i) => (
          <div key={i.code} className="alert"><span className="ic">!</span><span>{i.message}</span></div>
        ))}
        {goal.warnings.map((w, idx) => (
          <div key={`w${idx}`} className="alert"><span className="ic">!</span><span>{w}</span></div>
        ))}

        {/* 计算结果 */}
        <div className="card">
          <div className="title row">
            <span>由公式算出</span>
            <span style={{ fontSize: 10 }}>{draft.bodyFatPct != null ? 'Katch-McArdle' : 'Mifflin-St Jeor'}</span>
          </div>
          <div className="krow">
            <span className="k">BMI</span>
            <span className="v">
              {bmiRes.value.toFixed(1)}
              <span className={`badge ${bmiRes.level}`} style={{ marginLeft: 8 }}>{bmiRes.label}</span>
            </span>
          </div>
          <div className="krow"><span className="k">基础代谢 BMR</span><span className="v">{goal.bmr.toLocaleString()}<small>kcal</small></span></div>
          <div className="krow"><span className="k">每日总消耗 TDEE</span><span className="v">{goal.tdee.toLocaleString()}<small>kcal</small></span></div>
          <div className="krow"><span className="k">安全下限</span><span className="v">{goal.kcalFloor.toLocaleString()}<small>kcal</small></span></div>
        </div>

        <div className="card">
          <div className="title row">
            <span>每日建议摄入</span>
            <span style={{ fontSize: 10 }}>
              {goal.dailyDeficit > 0 ? `缺口 ${goal.dailyDeficit}` : goal.dailyDeficit < 0 ? `盈余 ${-goal.dailyDeficit}` : '持平'}
              {weeks != null ? ` · 约 ${weeks} 周` : ''}
            </span>
          </div>
          <div className="big">
            <b>{goal.kcal.toLocaleString()}</b>
            <span>kcal / 天</span>
          </div>
          <div className="macro3">
            <div><span>蛋白质</span><b>{goal.proteinG} g</b></div>
            <div><span>脂肪</span><b>{goal.fatG} g</b></div>
            <div><span>碳水</span><b>{goal.carbsG} g</b></div>
          </div>
          <div className="divider" />
          <div className="krow"><span className="k">膳食纤维</span><span className="v">{goal.fiberG}<small>g</small></span></div>
          <div className="krow"><span className="k">钠上限</span><span className="v">{goal.sodiumLimitMg.toLocaleString()}<small>mg</small></span></div>
          <div className="krow">
            <span className="k">宏量热量校验</span>
            <span className="v">
              {(goal.proteinG * 4 + goal.fatG * 9 + goal.carbsG * 4).toLocaleString()}
              <small>/ {goal.kcal}</small>
            </span>
          </div>
        </div>

        <div style={{ marginTop: 13 }}>
          <button
            disabled={blocked}
            onClick={() => void save()}
            style={{
              width: '100%', padding: '14px 0', borderRadius: 13, fontSize: 14, fontWeight: 700,
              background: blocked ? 'var(--card2)' : 'linear-gradient(135deg,#4ade80,#22c55e)',
              color: blocked ? '#3a4553' : '#06210f',
            }}
          >
            {blocked ? '请先修正上面标红的问题' : saved ? '已保存 ✓' : '保存档案并重算目标'}
          </button>
        </div>

        <div className="hint">
          依据中国居民膳食营养素参考摄入量（2023）与 Mifflin-St Jeor 公式。<br />
          以上为一般性建议，特殊情况请遵医嘱。
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="title">数据</div>
          <div className="krow">
            <span className="k">存储位置</span>
            <span className="v" style={{ fontSize: 11, color: 'var(--dim)' }}>浏览器本地 IndexedDB</span>
          </div>
          <div className="krow">
            <span className="k">备份导出</span>
            <span className="v" style={{ fontSize: 11, color: 'var(--mute)' }}>P5 接入</span>
          </div>
        </div>

        <button
          onClick={() => nav('/settings')}
          style={{ width: '100%', marginTop: 10, padding: '12px 0', fontSize: 12.5, color: 'var(--dim)' }}
        >
          AI 与高级设置
        </button>
      </div>
    </>
  );
}
