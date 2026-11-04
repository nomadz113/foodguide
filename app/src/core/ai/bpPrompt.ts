/**
 * 血压计屏幕识别的提示词。
 *
 * 这里是整个血压功能里**唯一**允许模型发表意见的地方，而且只允许它做一件事：
 * 把屏幕上有的数字读出来。分级、达标、要不要就医全在 core/bp/engine.ts 用代码算。
 *
 * 三条不能让步的约束，每一条都对应一个真实的失败案例：
 *
 * 1. **看不清就返回 null，不许猜。** 七段数码管的 1/7、0/8、3/9 在斜角度下会互换，
 *    模型"合理推测"出的 138 可能是真实读数的 158。猜错比读不出来危险得多 ——
 *    前者会安静地进趋势图，后者会让用户重新拍一张。
 * 2. **按屏幕标签定位，不按数字位置。** 腕式机型把舒张压印在上面、臂式在下面，
 *    还有机型只显示 "↑130 ↓85" 而不印 SYS/DIA 字样。
 * 3. **单位如实上报，由代码换算。** 让模型做 kPa→mmHg 的乘法等于引入一次不必要的
 *    心算；它 reporting 出来 "11.9/7.5" 我们换算，比它换算完再报更可验证。
 */

import type { PressureUnit } from '../bp/guard';

export const BP_VISION_SYSTEM_PROMPT = `你负责读取照片里电子血压计（或医院自助测量仪、微信小程序/HIS 截图）屏幕上显示的血压读数，严格按照 JSON 输出。

【最高原则：不许猜】
- 某个数字看不清、被反光糊住、被手指挡住、只有一半，就填 null。绝对不要用"常见数值"去补全。
- 宁可返回不完整的结果让用户重拍，也不要返回一个你不确定但看起来合理的数字。猜错的代价是用户信以为真。
- 每张图只描述你**真实看见**的字符，不要根据常识推断。

【输出字段】
{
  "found": true,                    // 图里是否存在血压读数。没有血压计就填 false
  "systolic": 126,                  // 高压 / SYS / 上面较大的数。看不清填 null
  "diastolic": 82,                  // 低压 / DIA / 下面较小的数。看不清填 null
  "pulse": 74,                      // 脉搏 / 心率 / PULSE / 心形图标旁的数。没有填 null
  "unit": "mmHg",                   // 屏幕标注的单位。"mmHg" 或 "kPa"，没标注就填 null
  "displayedAt": "2026-10-26 08:12", // 屏幕上**显示**的日期时间（很多机型会显示）。
                                    // 只有真的看见了才填，格式 YYYY-MM-DD HH:mm。
                                    // 只看见时间没看见日期填 "????-??-?? HH:mm"，什么都看不见填 null。
                                    // 这是测量时刻，比照片文件的拍摄时间更可信 —— 补拍三天前的记录时全靠它。
  "device": "欧姆龙 HEM-7136",       // 屏幕上的品牌/型号文字。认不出填 null
  "irregular": false,               // 是否出现心律不齐标记。见下方【心律不齐】，不确定必须填 null
  "isAverage": false,               // 屏幕上是否标明这是**平均值**（AVG / AVERAGE / "平均" / "7天平均" / "月平均"）。
                                    // 这一点极重要：把历史平均值当成一次新测量，趋势图会被一个假数据点压平。不确定填 null
  "note": "袖带缠绕偏松提示",         // 屏幕上其他值得注意的文字提醒，如"体动"、"袖带松"、"E1"。没有填 null
  "rawSegments": ["126", "82", "74", "08:12"], // 你**看见**的原始字符片段，原样列出，不要加工。
                                    // 用来在数字有争议时回溯"模型到底看到了什么"
  "confidence": 0.95                // 你对这次读数的把握。看不太清就给低分
}

【读数怎么认】
- 认屏幕上印的标签（SYS/SYSTOLIC/高压/↑ 与 DIA/DIASTOLIC/低压/↓，PULSE/脉搏/心率/♡）。
- **不要按位置推断**：有的机型把低压印在高压上面。以标签为准。
- 机型差异：水银柱、微信小程序截图、体检报告都可识别，读数以页面上的数字为准。
- 一张图里有多次测量（如列表页），取**最新一条**（时间最大的那条），其余忽略。

【心律不齐】这条是唯一一个"不确定也要如实说"的字段
- 只对**明确的标记**填 true：心形图标内部有一条心电图/折线波形、心形带缺口，
  或屏幕上印了 IHB / "不规则脉波" / "心律不齐" 字样。
- 一个普普通通陪在脉搏旁边的心形**不算** —— 很多机型任何时候都印着它。
- **看不清、看不全、拿不准就填 null，不要填 false。** 填 false 等于替这台机器宣布
  "这次心律整齐"，而我们有实录：模型在一个真实的心律不齐图标上答过 false。

【不要做】
- 不要换算单位。看到 kPa 就上报 unit="kPa" 和原始数值。
- 不要对读数是否正常发表任何意见，不要给健康建议。
- 不要把你的推断写进 rawSegments —— 那里只允许出现你真实看到的字符。

【什么都没有时】
{"found": false, "systolic": null, "diastolic": null, "pulse": null, "unit": null, "displayedAt": null, "device": null, "irregular": null, "isAverage": null, "note": null, "rawSegments": [], "confidence": 0}

只输出 JSON。`;

export function buildBpUserText(): string {
  return '读这张图里血压计屏幕上的读数。看不清就填 null，不要猜。只输出 JSON。';
}

/** 模型直接返回的结构。字段全是"可能有"，交给 guard.ts 校验后才算数 */
export interface BpRawDraft {
  found: boolean;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  unit: PressureUnit | null;
  /** 屏幕显示的测量时刻字符串 */
  displayedAt: string | null;
  device: string | null;
  irregular: boolean | null;
  isAverage: boolean | null;
  note: string | null;
  rawSegments: string[];
  confidence: number | null;
}

const UNKNOWN_DATE = '????-??-??';

/**
 * 把 displayedAt 解析成毫秒。
 *
 * 允许日期缺失（只有 "????-??-?? 08:12" 这种），这时拿传入的 fallback 日期补上 ——
 * 屏幕没印日期是常态，这台机器显然认为自己只显示时间就够了。
 * 返回 null 表示连时间都没读出来。
 */
export function parseDisplayedAt(raw: string | null, fallbackDate?: Date): number | null {
  if (!raw) return null;
  const s = raw.trim();
  // 日期分隔符允许 "-" 也允许 ":"：模型见过太多 EXIF 字符串，
  // 偶尔会把 "2026:10:23 08:12:34" 这种格式抄回来。能救回来就别降级。
  const m = s.match(/^(\d{4}|\?{4})[-:](\d{2}|\?{2})[-:](\d{2}|\?{2})[T ]?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, ys, mos, ds, hs, mis] = m;
  const H = Number(hs);
  const Mi = Number(mis);
  if (!Number.isFinite(H) || !Number.isFinite(Mi)) return null;
  if (H > 23 || Mi > 59) return null;

  const base = fallbackDate ?? new Date();
  // 日期部分是问号就用兜底日期，且该兜底日期必须是有效 Date
  const useFallback = ys === UNKNOWN_DATE || mos === '??' || ds === '??';
  const Y = useFallback ? base.getFullYear() : Number(ys);
  const Mo = useFallback ? base.getMonth() + 1 : Number(mos);
  const D = useFallback ? base.getDate() : Number(ds);
  if (!Number.isFinite(Y) || !Number.isFinite(Mo) || !Number.isFinite(D)) return null;

  const dt = new Date(Y, Mo - 1, D, H, Mi, 0, 0);
  const t = dt.getTime();
  return Number.isFinite(t) ? t : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/** 宽松解析：任何字段缺失/类型不对都退化成 null，交给下一层的 checkReading 判定 */
export function parseBpDraft(raw: unknown): BpRawDraft {
  const o = (raw ?? {}) as Record<string, unknown>;
  const unitRaw = typeof o.unit === 'string' ? o.unit.trim().toLowerCase() : '';
  const unit: PressureUnit | null =
    unitRaw === 'kpa' ? 'kPa' : unitRaw === 'mmhg' ? 'mmHg' : null;

  const conf = num(o.confidence);

  return {
    found: o.found === true || typeof o.found === 'string' && o.found === 'true',
    systolic: num(o.systolic),
    diastolic: num(o.diastolic),
    pulse: num(o.pulse),
    unit,
    displayedAt: typeof o.displayedAt === 'string' && o.displayedAt.trim() ? o.displayedAt.trim() : null,
    device: typeof o.device === 'string' && o.device.trim() ? o.device.trim().slice(0, 40) : null,
    irregular: bool(o.irregular),
    isAverage: bool(o.isAverage),
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 80) : null,
    rawSegments: Array.isArray(o.rawSegments) ? o.rawSegments.map(String).slice(0, 12) : [],
    confidence: conf == null ? null : Math.min(1, Math.max(0, conf)),
  };
}
