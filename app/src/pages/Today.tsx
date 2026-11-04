import type { ComponentType } from 'react';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { mealsOfDay, softDeleteMeal, latestBp, bpsInRange } from '../core/db/repo';
import {
  BP_LABEL, EVENING, HOME_BP_DAYS, MORNING, bpWindow, classify, summariseBp, toneOf,
  type BpReading,
} from '../core/bp/engine';
import { SLOT_LABELS, slotTotals, sumMeals } from '../core/meal/build';
import { localAdvice } from '../core/advice/local';
import { formatClock, formatDayLabel } from '../core/date';
import type { MealSlot } from '../core/db/types';
import type { NutrientKey } from '../core/nutrition/types';
import { useAppData } from '../store/AppData';
import { Ring } from '../ui/Ring';
import { MacroRows } from '../ui/MacroRows';
import { MicroGrid, microSummary } from '../ui/MicroGrid';
import { AdviceCard } from '../ui/AdviceCard';
import { TONE_VAR } from '../ui/bpTone';
import {
  IconBreakfast, IconChevron, IconDinner, IconLunch, IconPencil, IconSnack, IconToday,
} from '../ui/icons';

/**
 * 餐次图标。原来这里是 ☀ ◐ ☾ ✚ —— 其中 ◐ 同时是 TabBar 的「小助手」，
 * 一个符号两种含义，而且四个符号都不在同一个视觉体系里（一个实心日、一个半圆、一个月牙、一个医疗十字）。
 */
const SLOT_ICON: Record<MealSlot, ComponentType<{ size?: number }>> = {
  breakfast: IconBreakfast,
  lunch: IconLunch,
  dinner: IconDinner,
  snack: IconSnack,
};

/** 带符号的整数：差值必须能看出方向，只写绝对值会被读反 */
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

function BpPair({ r }: { r: BpReading | null }) {
  if (!r) return <b style={{ fontSize: 15, color: 'var(--mute)' }}>—</b>;
  return <b style={{ fontSize: 15 }}>{r.systolic}/{r.diastolic}</b>;
}

export function TodayPage() {
  const { profile, goal, today } = useAppData();
  const nav = useNavigate();
  /** 微量营养素默认收起：14 格是"想细看时再看的"，不该占据首屏的半屏高度 */
  const [microOpen, setMicroOpen] = useState(false);
  /** 今日记录同样默认收起：一餐没记时它已经在说「还没有记录」，记了之后逐条列表
      又会把血压卡推到屏幕外。收起后头行仍报「N 餐 M 项」，一眼能确认记没记。 */
  const [recordsOpen, setRecordsOpen] = useState(false);

  const meals = useLiveQuery(() => mealsOfDay(today), [today]);
  // 两条血压数据合在**同一次查询**里取回 —— 拆成两个 useLiveQuery 会让这一页多一次
  // 「先到一半」的渲染：血压卡先画出「还没有血压记录」，紧接着被真实数据替换，闪一下。
  // 一次查询就是一个状态，没有中间态。
  const bpWin = bpWindow(today, HOME_BP_DAYS);
  const bpData = useLiveQuery(async () => {
    const [latest, recent] = await Promise.all([
      latestBp(),
      bpsInRange(bpWin.from, bpWin.to),
    ]);
    return { latest, recent };
  }, [today]);

  if (!meals || !bpData) return <div className="main center">读取中…</div>;

  const bp = bpData.latest;
  const bpSum = summariseBp(bpData.recent);

  const sum = sumMeals(meals);
  const t = sum.totals;
  const kcal = typeof t.kcal === 'number' ? t.kcal : 0;
  const protein = typeof t.protein === 'number' ? t.protein : 0;
  const fiber = typeof t.fiber === 'number' ? t.fiber : 0;

  const microTargets: Partial<Record<NutrientKey, number | null>> = {
    ...goal.micro,
    fiber: goal.fiberG,
  };
  const micro = microSummary(t, sum.coverage, microTargets);

  const advice = localAdvice({ kcal, protein, fiber, mealCount: sum.mealCount, goal });
  const slots = slotTotals(meals);
  const planLine = (['breakfast', 'lunch', 'dinner', 'snack'] as const)
    .filter((s) => slots[s] > 0)
    .map((s) => `${SLOT_LABELS[s]} ${Math.round(slots[s])}`)
    .join(' · ');

  /** 晨 − 晚。只在两侧样本都够时给，否则这个差值本身就是噪声 */
  const bpDelta = bpSum.windowComparable && bpSum.morningMean && bpSum.eveningMean
    ? {
      systolic: bpSum.morningMean.systolic - bpSum.eveningMean.systolic,
      diastolic: bpSum.morningMean.diastolic - bpSum.eveningMean.diastolic,
    }
    : null;

  async function remove(id: string, kcalOf: number) {
    if (!window.confirm(`删除这条记录（${Math.round(kcalOf)} kcal）？`)) return;
    await softDeleteMeal(id);
  }

  return (
    <>
      <div className="hdr">
        <div>
          <h1>{formatDayLabel(today)}</h1>
          <div className="sub">
            {profile.goalType === 'lose' ? '减脂' : profile.goalType === 'gain' ? '增肌' : profile.goalType === 'maintain' ? '维持' : '健康改善'}
            {' · '}
            {sum.mealCount > 0 ? `${sum.mealCount} 餐 · ${sum.itemCount} 项` : '尚未记录'}
          </div>
        </div>
        {/* 这里原本还有一颗 ⌾ 拍照按钮 —— 底部导航正中间就是同一个入口，
            离拇指更近、面积大 3 倍。一个动作两个入口，只会让右上角多一个要解码的符号。 */}
        <span className={`pill ${kcal > goal.kcal ? 'bad' : 'ok'}`}>
          {kcal > goal.kcal ? `超出 ${Math.round(kcal - goal.kcal)}` : `剩 ${Math.round(goal.kcal - kcal)}`} kcal
        </span>
      </div>

      <div className="main">
        <Ring value={kcal} target={goal.kcal} />

        {/* 配额卡：宏量三条。
            钠 / 盐那一段已整块删除 —— 钠的合计会被「这道菜放了多少盐」主导，
            而盐是模型看图猜的，误差能到一倍以上；一个量不准又占据视觉重心的指标，
            比没有这个指标更糟。微量在下面的折叠行里，一项没丢。 */}
        <div className="card" style={{ marginTop: 6 }}>
          <MacroRows totals={t} targets={{ protein: goal.proteinG, fat: goal.fatG, carbs: goal.carbsG }} />
        </div>

        <AdviceCard
          local={advice}
          totals={t}
          coverage={sum.coverage}
          meals={meals}
          profile={profile}
          goal={goal}
          planLine={planLine}
        />

        {/* 微量 14 格默认收起。位置在建议卡（含「今日来源 TOP3」）之下 ——
            原来它夹在宏量卡与建议卡之间，把「今天还剩多少 → 这说明什么」这条主线切断；
            现在它和 TOP3 挨着，两者都是「想深挖时再看」的明细。
            折叠而不是"精选 6 项"：这个 App 的价值主张就是 19 项全覆盖，
            藏掉 VA/B1/烟酸 等于自砍卖点。折叠只是把信息挪到点击后面，一项都没丢。
            展开用 hidden 做 CSS 显隐，不换查询 —— 重新查库会闪一下「—」。 */}
        <div className={`fold ${microOpen ? 'open' : ''}`}>
          <button onClick={() => setMicroOpen((v) => !v)} aria-expanded={microOpen}>
            <span>
              微量营养素
              {micro.known > 0
                ? ` · ${micro.known} 项有数据${micro.hit > 0 ? ` · 达标 ${micro.hit}` : ''}`
                : ` · ${micro.total} 项待补`}
            </span>
            <span className="chev"><IconChevron size={16} /></span>
          </button>
          <div className="body" hidden={!microOpen}>
            <MicroGrid totals={t} coverage={sum.coverage} targets={microTargets} />
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          {/* 空态**不折叠**：折起来会把「点中间的相机拍一张」这条唯一引导藏到一次点击后面，
              而标题行写「今日记录 · 0 餐 0 项」本身就是一句废话。 */}
          {meals.length === 0 ? (
            <>
              <div className="row" style={{ padding: '0 2px', marginBottom: 8 }}>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--dim)' }}>今日记录</span>
              </div>
              <div className="empty">
                <span className="ic"><IconToday size={26} /></span>
                还没有记录。<br />点中间的相机拍一张，或者跟小助手说一句。
              </div>
            </>
          ) : (
            /* 用 .fold.plain：这里每条餐次本身就是一张卡片，
               外面再套一层带底色的 .fold 会变成卡中卡（两层描边、两层白底）。 */
            <div className={`fold plain ${recordsOpen ? 'open' : ''}`} style={{ marginTop: 0 }}>
              <button onClick={() => setRecordsOpen((v) => !v)} aria-expanded={recordsOpen}>
                <span>今日记录 · {meals.length} 餐 {sum.itemCount} 项</span>
                <span className="chev"><IconChevron size={16} /></span>
              </button>
              <div className="body" hidden={!recordsOpen}>
                {meals.map((m) => {
              const k = typeof m.totals.kcal === 'number' ? m.totals.kcal : 0;
              const names = m.items.map((i) => i.name).join(' · ');
              const SlotIcon = SLOT_ICON[m.slot];
              return (
                <div className="meal" key={m.id}>
                  <div className="thumb" style={{ color: 'var(--green)' }}>
                    {SlotIcon ? <SlotIcon size={18} /> : '·'}
                  </div>
                  <div className="info">
                    <div className="n">{names || '未命名'}</div>
                    <div className="d">
                      {formatClock(m.eatenAt)} · {SLOT_LABELS[m.slot]} · {m.items.length} 项
                    </div>
                  </div>
                  <div className="kcal">
                    <b>{Math.round(k)}</b>
                    <span>kcal</span>
                  </div>
                  <button
                    className="edit"
                    aria-label="编辑"
                    title="编辑这一餐"
                    onClick={() => nav(`/meal/${m.id}`)}
                  >
                    <IconPencil size={14} />
                  </button>
                  <button className="del" aria-label="删除" onClick={() => void remove(m.id, k)}>×</button>
                </div>
              );
                })}
              </div>
            </div>
          )}

          {/* 「记一餐」留在折叠体**外面**：折叠只收内容，不收操作。
              否则收起状态下想手动记一餐，得先点开面板才能找到入口 —— 等于藏了一个功能。 */}
          <button className="btn-ghost-wide" onClick={() => nav('/add')}>
            记一餐 · 搜索食物
          </button>
        </div>

        {/* 血压：原来拆了两张卡（最新一次 + 近 14 天晨晚峰），合计 440px，占页面尾部 25%。
            但两张卡讲的其实是同一件事 —— 血压怎么样。合成一张，晨晚峰退成一行。

            血压卡显示的是最新一次、**可能不是今天的** —— 昨天晚上量的，在今天早上
            依然是"最近那次"，所以日期必须紧跟在数值旁，别被读成今天的值。 */}
        <div className="card">
          <div className="bphd">
            <span className="k">血压</span>
            {bp ? (
              <span style={{ color: TONE_VAR[toneOf(bp)] }}>
                <b>{bp.systolic}/{bp.diastolic}</b>
                <em>{BP_LABEL[classify(bp)]}</em>
              </span>
            ) : (
              <span className="none">还没有记录</span>
            )}
          </div>

          {bp ? (
            <div className="bpmeta">
              {formatDayLabel(bp.date, today)} {formatClock(bp.measuredAt)} · mmHg
            </div>
          ) : null}

          {/* 晨峰 / 晚峰：只看最近 14 天。零记录时整行不渲染 ——
              上面已经说过「还没有记录」，再来一行空的是重复。
              只说差值，不说「晨峰偏高」：本项目不做诊断，两侧各 3 次的差值
              本来就可能只是那几天睡得不一样。 */}
          {bpSum.recordedDays > 0 && (
            <div className="bpline">
              <span className="k">近 {HOME_BP_DAYS} 天</span>
              <span>
                晨 {MORNING[0]}–{MORNING[1]}点 <BpPair r={bpSum.morningMean} />
                <i>{bpSum.morningCount} 次</i>
              </span>
              <span>
                晚 {EVENING[0]}–{EVENING[1]}点 <BpPair r={bpSum.eveningMean} />
                <i>{bpSum.eveningCount} 次</i>
              </span>
              {bpDelta ? (
                <span className="d">
                  晨−晚 {signed(bpDelta.systolic)}/{signed(bpDelta.diastolic)}
                </span>
              ) : null}
            </div>
          )}

          <div className="bpact">
            <button onClick={() => nav('/bp/capture')}>{bp ? '再记一次' : '记一次'}</button>
            <button onClick={() => nav('/stats?tab=bp')}>查看趋势 ›</button>
          </div>
        </div>

        <div className="hint">
          份量靠估算，误差客观存在。记录的价值在于趋势，不在单餐精确到克。
        </div>
      </div>
    </>
  );
}
