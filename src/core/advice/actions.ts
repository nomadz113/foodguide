/**
 * 可执行建议的「数字来源」。
 *
 * 教训：只靠提示词说「不要自己算」，模型照算不误 ——
 * 实测让它建议补蛋白，它写出「150g 鸡胸肉补约 45g 蛋白」（实际 29g）。
 * 而且这种错误没法被用户发现，看起来非常专业。
 *
 * 所以改成：克数、份数、缺口全部在这里算好，模型只能引用或改写措辞，
 * 返回后还要再过一道数字溯源校验（见 ai/advice.ts::parseAdvice）。
 */

export interface ActionInput {
  proteinGap: number;
  fiberGap: number;
  remain: number;
  kcalTarget: number;
  saltG: number | null;
  saltLimitG: number;
  mealCount: number;
}

/** 常见补蛋白食物的单位含量，与 advice/local.ts 保持一致 */
const CHICKEN_PROTEIN_PER100 = 19.4;
const EGG_PROTEIN = 6.65;
/** 绿叶菜膳食纤维约 2.2g/100g */
const LEAFY_FIBER_PER100 = 2.2;
/** 一天蔬菜量的现实上限：500g 大约是一斤，超过这个数就不是「建议」而是「刁难」 */
const MAX_VEG_G = 500;

const r0 = (n: number) => Math.round(n);

/** 按 5g 取整，避免出现「173g 鸡胸肉」这种看起来精确其实靠猜的数字 */
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const round50 = (n: number) => Math.max(50, Math.round(n / 50) * 50);

export function suggestActions(a: ActionInput): string[] {
  const out: string[] = [];

  if (a.mealCount === 0) {
    return ['先记下第一餐，哪怕只写「一碗米饭 + 一个鸡蛋」，后面的判断才有依据'];
  }

  if (a.proteinGap > 60) {
    const per = round5(a.proteinGap / 2 / CHICKEN_PROTEIN_PER100 * 100);
    out.push(
      `蛋白还差 ${r0(a.proteinGap)}g，一顿吃不下：分两餐各加 ${per}g 鸡胸肉（约 ${r0(per * CHICKEN_PROTEIN_PER100 / 100)}g 蛋白）`,
    );
  } else if (a.proteinGap > 15) {
    const g = round5(a.proteinGap / CHICKEN_PROTEIN_PER100 * 100);
    const eggs = Math.max(1, Math.round(a.proteinGap / EGG_PROTEIN));
    out.push(`加 ${g}g 鸡胸肉或 ${eggs} 个鸡蛋，补上 ${r0(a.proteinGap)}g 蛋白缺口`);
  }

  if (a.fiberGap > 8) {
    /**
     * 蔬菜量必须封顶。纤维缺口 30g 时按 2.2g/100g 反推需要 1.3kg 绿叶菜，
     * 算得没错，但没人一顿吃得下 2.7 斤菜 —— 这种「精确但做不到」的建议等于没给。
     */
    const veg = Math.min(MAX_VEG_G, round50(a.fiberGap / LEAFY_FIBER_PER100 * 100));
    const got = (veg * LEAFY_FIBER_PER100) / 100;
    const rest = a.fiberGap - got;
    const tail = rest > 4
      ? `，剩 ${r0(rest)}g 分几次用水果和杂豆补，一顿吃不完`
      : '';
    out.push(`加 ${veg}g 绿叶菜（约 ${r0(got)}g 纤维）${tail}`);
  }

  if (a.saltG != null && a.saltG > a.saltLimitG * 0.8) {
    out.push(`盐已 ${a.saltG}g（上限 ${a.saltLimitG}g），接下来两餐选白灼或清蒸，别再加酱油和蚝油`);
  }

  if (a.remain > 400) {
    out.push(`还剩 ${r0(a.remain)} kcal，下一餐按 1 份主食 + 1 份蛋白 + 2 份蔬菜配，别留到夜里补`);
  } else if (a.remain < -50) {
    out.push(`已超出 ${r0(-a.remain)} kcal，今天不用补偿，明天按正常目标吃即可`);
  }

  if (out.length === 0) {
    out.push(`各项都接近目标（还差 ${r0(a.remain)} kcal），剩下这点空间不用精确到克`);
  }

  return out.slice(0, 3);
}
