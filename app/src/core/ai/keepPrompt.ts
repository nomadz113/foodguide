/**
 * Keep 体脂秤 / 体重截图识别的提示词与解析。
 *
 * 和血压（bpPrompt.ts）是同一形态，但有三个体脂秤独有的陷阱，
 * 每一个都比血压的「高低压读反」更隐蔽：
 *
 * 1. **体脂率和水分率都是百分比，数值区间重叠。** 22.8% 既可能是体脂率也可能是
 *    水分率，靠数字本身分辨不了，只能认标签。血压至少还能用「高压必须大于低压」
 *    做交叉校验，这里没有等价的兜底 —— 读错就是读错。
 * 2. **屏幕上的时间几乎都是相对表述。** Keep 写「今天 08:12」「昨天」「3 天前」，
 *    而模型不知道今天几号，让它换算成日期必然瞎编。所以只让它**原样抄**，
 *    换算交给 parseKeepTime 用本机时钟做 —— 这是本文件最重要的分工。
 * 3. **列表页、趋势图、平均值卡片都和单次测量长得像。** 从折线图上估读出来的数字
 *    会被当成一次真实测量写进趋势，而且事后完全看不出它来自坐标轴。
 *
 * 还有一条和血压共同的纪律：**看不清就 null，绝不猜。** 体重差 0.5 kg 无所谓，
 * 但体脂率一旦有值，档案的 BMR 会从 Mifflin 换成 Katch-McArdle，全天的热量目标
 * 跟着变 —— 一个编出来的 22% 会安静地改掉用户接下来所有建议。
 */

export type WeightUnit = 'kg' | 'lb';

export const KEEP_SCALE_SYSTEM_PROMPT = `你负责读取健身 App（主要是 Keep，也可能是其它体重管理 App）或智能体脂秤配套 App 截图里的**体重**和**体脂率**，严格按照 JSON 输出。

【最高原则：不许猜】
- 某个数字看不清、被弹窗/水印/手指挡住、只显示一半，就填 null。绝对不要用"常见数值"去补全。
- **不要从折线图、进度环、颜色条、体型图上估算数值。** 图上没有印出来的数字一律填 null。
- 每张图只描述你**真实看见**的字符，不要根据常识或历史记录推断。

【输出字段】
{
  "found": true,                 // 图里是否有体重读数。聊天界面、课程页、商城页都填 false
  "weight": 72.4,                // 体重数值，只要数字，不要带单位。看不清填 null
  "unit": "kg",                  // 体重单位："kg" 或 "lb"。没标注就填 null（不要默认 kg）
  "bodyFatPct": 22.8,            // 体脂率百分比数值，只要数字。没有这项、显示 "--" 或 "—" 都填 null
  "timeText": "今天 08:12",       // 页面上**时间那一行的原文**，见下方【时间怎么抄】
  "isAggregate": false,          // 这个数字是不是平均值/统计值，见下方【平均值】，不确定填 null
  "device": "Keep 体脂秤 S3",     // 页面上的设备名/型号文字。认不出填 null
  "note": "测量时未穿鞋",          // 页面上其它值得注意的短文字。没有填 null
  "rawSegments": ["72.4", "22.8", "今天 08:12"], // 你**看见**的原始字符，原样列出，不要加工
  "confidence": 0.95             // 你对这次读数的把握。看不太清就给低分
}

【读数怎么认】
- **只读这三个数字：体重、体脂率、（以及时间文字）。** 看到 BMI、肌肉量、水分率、基础代谢、内脏脂肪、骨量、蛋白率，一律忽略，不要放进任何字段。
- **认标签，不认位置，也不认大小。** 体重常写成 体重 / 体重(kg) / WEIGHT / 当前体重；
  体脂率常写成 体脂率 / 体脂 / 脂肪率 / BODY FAT / 脂肪百分比。
- **体脂率和水分率必须靠标签区分**：两者都是百分比、区间也重叠（22.8% 既可能是体脂率也可能是水分率），
  数字本身分辨不了。只写了「水分 / 体水分 / BODY WATER / 水分率」的，不是体脂率。
  标签看不清就填 null，**绝不按"看起来像体脂率"来填**。
- BMI 不是体重：BMI 通常是 15~40 的一位小数，体重通常是一位小数的 30~200 之间。两者紧挨着印时尤其要看清标签。
- 「较上次 -0.3 kg」「-0.3」这类是**变化量**，不是当前体重，不要填进 weight。

【时间怎么抄】这一条极重要
- timeText 只允许出现页面上的**原文字符**：如 "今天 08:12"、"昨天"、"前天 21:30"、"3 天前"、"10月24日 07:35"、"2026-10-24 08:12"。
- **不要自己换算成日期，不要补年份，不要写"约等于"。** 你不知道今天是几号，
  任何换算都是编的。原文是"今天"就写"今天"，原文没有时间就填 null。
- 一张图里有多个时间（如列表每条都有），抄你选中那条的时间。

【平均值】
- 页面上出现「平均」「近 7 天平均」「周平均」「月平均」「趋势」「AVG」等字样，
  且这个平均数字就在你取的那个数旁边，填 true。
- 只是显示历史曲线、但当前读数没有标"平均"，填 false。
- 拿不准必须填 null —— 把平均值当成一次新测量，趋势图会被一个假数据点压平。

【列表页和多条记录】
- 一张图里有多条记录（历史列表）时，取**时间最大（最新）的那一条**，其余忽略。
- 若最新那条的时间写着"今天"或"昨天"，就按原文抄。
- 若整个页面只有一条记录，就是它。

【不要做】
- 不要换算单位。看到 lb 就上报 unit="lb" 和原始数值，换算由代码做。
- 不要对体重是否正常发表任何意见，不要给饮食或运动建议。
- 不要把推断写进 rawSegments —— 那里只允许出现你真实看到的字符。

【什么都没有时】
{"found": false, "weight": null, "unit": null, "bodyFatPct": null, "timeText": null, "isAggregate": null, "device": null, "note": null, "rawSegments": [], "confidence": 0}

只输出 JSON。`;

export function buildKeepUserText(): string {
  return '读这张图里体重和体脂率。只读这三个数字：体重、体脂率、时间原文。看不到就填 null，不要猜。只输出 JSON。';
}

/** 模型直接返回的结构。字段全是"可能有"，交给 guard.ts 校验后才算数 */
export interface KeepRawDraft {
  found: boolean;
  weight: number | null;
  unit: WeightUnit | null;
  bodyFatPct: number | null;
  /** 页面上时间那一行的**原文**，未经换算 */
  timeText: string | null;
  /** true=平均值/统计值，false=单次测量，null=说不准 */
  isAggregate: boolean | null;
  device: string | null;
  note: string | null;
  rawSegments: string[];
  confidence: number | null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/**
 * 数字解析，专门对付模型抄回来的各种写法。
 *
 * 空串必须返回 null —— `Number('')` 是 0，直接透传会让"没读到"变成"体重 0 kg"
 * 或"体脂率 0%"，而 0% 体脂率会被 buildGoalSnapshot 当成有效值切到 Katch-McArdle。
 * 同理 `--`、`—`、`Err` 这些"没有数据"的占位符也必须是 null。
 */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v
    .trim()
    .replace(/[％%]$/, '')
    .replace(/(?:kg|KG|Kg|lb|LB|Lb)$/, '')
    .replace(/,/g, '.')
    .trim();
  if (!s) return null;
  // 「--」「—」「–」「Err」「N/A」这类"没有数据"的写法
  if (/^[-—–]+$/.test(s) || /^(?:err|n\/?a|null|none)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 页面上时间那一行的最长合理长度。防模型把整段说明抄进来 */
const MAX_TIME_TEXT = 40;

/** 从时间文字里抠 HH:mm。抓不到就返回 null（只有日期没有时间的页面是存在的） */
function hourMinute(s: string): { h: number; m: number } | null {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}

/** 组装本地时刻。日/月越界（2 月 30 日这类）返回 null，而不是让 Date 自动进位 */
function makeTime(y: number, mo: number, d: number, hm: { h: number; m: number } | null): number | null {
  const dt = new Date(y, mo - 1, d, hm?.h ?? 0, hm?.m ?? 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  const t = dt.getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 把页面上的时间原文解析成毫秒，解析不出返回 null。
 *
 * **为什么必须在代码里做而不是让模型做**：Keep 上写的是「今天 08:12」「昨天」「3 天前」，
 * 模型不知道今天是几号，让它换算只能得到编出来的日期。原文抄回来、本机时钟换算，
 * 是唯一能保证正确的分工。
 *
 * 支持：今天/今日/刚才/刚刚、昨天/昨日、前天、N 天前、M月D日、YYYY-MM-DD、
 * MM-DD（补今年，若算出未来则退到去年）。
 *
 * 刻意**不支持**只有时间（"08:12"）的输入：那天到底是今天还是昨天只有用户知道，
 * 猜错会让记录落到错误的归档日。返回 null 让上层退到文件时间，并在 UI 上如实标注。
 *
 * 关于「昨天」与 App 的日切：App 按 settings.dayStartHour（默认 4 点）切日，
 * 所以凌晨 1 点看到的「昨天 21:30」会归档到"前天"。这是正确行为 ——
 * 21:30 在 4 点切日线之上，本就属于前一个统计日。
 */
export interface KeepTimeParts {
  /** 解析出的毫秒时刻；页面上的日期认不出来时为 null */
  ms: number | null;
  /**
   * 原文里有没有带时钟（HH:mm）。
   *
   * false 表示**只知道是哪一天，不知道几点**。这时 ms 的时分是 00:00，
   * 但那不是「零点量的」，只是 makeTime 的占位 0 —— 直接拿去用会得到一条
   * 「0 点 0 分称体重」的记录，任何人一看就知道是假的。
   * 上层必须把时分换成别处的信息（截图文件时间），只保留这里的日期。
   */
  hasClock: boolean;
}

export function parseKeepTimeParts(text: string | null, now: Date = new Date()): KeepTimeParts {
  const none: KeepTimeParts = { ms: null, hasClock: false };
  if (!text) return none;
  const s = text.trim();
  if (!s) return none;

  // ① 完整日期：2026-10-24 / 2026/10/24 / 2026年10月24日（也接受 EXIF 的冒号分隔）
  const full = s.match(/(\d{4})\s*[-/:年]\s*(\d{1,2})\s*[-/:月]\s*(\d{1,2})/);
  if (full) {
    // 日期本身可能用冒号分隔（模型常把 EXIF 的 "2026:10:24 08:12" 原样抄回来）。
    // 这时整句直接找 HH:mm 会先咬到 "26:10"，被当成 26 点而丢掉真正的时间。
    // 先把日期那段剔掉，再在剩下的部分里找时间。
    const rest = s.replace(full[0], ' ');
    const hm = hourMinute(rest);
    return {
      ms: makeTime(Number(full[1]), Number(full[2]), Number(full[3]), hm),
      hasClock: hm != null,
    };
  }

  const hm = hourMinute(s);
  const hasClock = hm != null;

  // ② 相对日：今天 / 昨天 / 前天 / N 天前
  const rel = (() => {
    if (/今天|今日|刚才|刚刚/.test(s)) return 0;
    if (/昨天|昨日/.test(s)) return 1;
    if (/前天/.test(s)) return 2;
    const n = s.match(/(\d+)\s*天前/);
    return n ? Number(n[1]) : null;
  })();
  if (rel != null && rel >= 0 && rel <= 365) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    base.setDate(base.getDate() - rel);
    return { ms: makeTime(base.getFullYear(), base.getMonth() + 1, base.getDate(), hm), hasClock };
  }

  // ③ 只有月日：10月24日 / 10-24
  const md = s.match(/(\d{1,2})\s*[月/-]\s*(\d{1,2})/);
  if (md) {
    const mo = Number(md[1]);
    const d = Number(md[2]);
    const y = now.getFullYear();
    const t = makeTime(y, mo, d, hm);
    if (t == null) return none;
    // 算出未来（今天 10-26 看到 12-03）说明是去年的记录。留 1 天余量给时区/时钟偏差。
    if (t > now.getTime() + 86_400_000) return { ms: makeTime(y - 1, mo, d, hm), hasClock };
    return { ms: t, hasClock };
  }

  // ④ 只有时间，或者完全不认识 —— 交回上层兜底，不猜
  return none;
}

/** 只要时刻，不关心有没有时分。需要区分两者时用 parseKeepTimeParts */
export function parseKeepTime(text: string | null, now: Date = new Date()): number | null {
  return parseKeepTimeParts(text, now).ms;
}

/** 宽松解析：任何字段缺失/类型不对都退化成 null，交给下一层的 checkScaleReading 判定 */
export function parseKeepDraft(raw: unknown): KeepRawDraft {
  const o = (raw ?? {}) as Record<string, unknown>;
  const unitRaw = typeof o.unit === 'string' ? o.unit.trim().toLowerCase() : '';
  const unit: WeightUnit | null = unitRaw === 'kg' ? 'kg' : unitRaw === 'lb' ? 'lb' : null;

  const conf = num(o.confidence);
  const timeText =
    typeof o.timeText === 'string' && o.timeText.trim() ? o.timeText.trim().slice(0, MAX_TIME_TEXT) : null;

  return {
    found: o.found === true || (typeof o.found === 'string' && o.found === 'true'),
    weight: num(o.weight),
    unit,
    bodyFatPct: num(o.bodyFatPct),
    timeText,
    isAggregate: bool(o.isAggregate),
    device: typeof o.device === 'string' && o.device.trim() ? o.device.trim().slice(0, 40) : null,
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 80) : null,
    rawSegments: Array.isArray(o.rawSegments) ? o.rawSegments.map(String).slice(0, 12) : [],
    confidence: conf == null ? null : Math.min(1, Math.max(0, conf)),
  };
}
