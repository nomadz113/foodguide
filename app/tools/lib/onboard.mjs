/**
 * 让一个脚本把「首次引导」走完，落到首页。
 *
 * 为什么需要：0.9.5 起空库不再自动写默认档案，所有真实浏览器脚本一起步都停在
 * 引导页。check-nav / check-theme 这类脚本本来是「打开就有首页」，现在会全部
 * 量到引导页 —— 它们不会报错，只会**量错东西**，比报错更难发现。
 *
 * 走的是真 UI，不是往 IndexedDB 里塞记录：引导页除了写 profile，还会写
 * settings.mode 和 goal 快照，手搓那套数据等于把被测逻辑抄一遍。
 */

/** 把值写进非受控 input：走原生 setter + input 事件，React 才读得到 */
async function setNative(page, selector, value) {
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    if (!el) return;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

async function clickText(page, text) {
  const hit = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  if (!hit) throw new Error(`引导页找不到按钮「${text}」`);
}

/**
 * 走完三步引导。已 onboarded 的库直接返回。
 * @returns {Promise<boolean>} true = 本次真的走了引导
 */
export async function completeOnboarding(page, { wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  // 第一行原本等的是 `.app, .welcome` —— **这是错的门**。`.app` 在 bootstrap
  // 还没读完数据时就挂上了（「正在准备本地数据…」那一屏也是 .app），于是这里
  // 会先等到 .app、紧接着判 .welcome 不存在、直接 return false「已引导」，
  // 调用方以为自己在量首页，实际量的是引导页 —— 又一次绿灯的瞎测。
  // 改成等「真正的两种落地形态」：引导页 .welcome / 首页页头 .hdr。
  await page.waitForSelector('.welcome, .hdr', { timeout: 20000 });
  if (!await page.evaluate(() => Boolean(document.querySelector('.welcome')))) return false;

  // 第一步：性别必须点一下（四项示例值都要本人确认过才放行）
  await clickText(page, '男');
  await setNative(page, 'input[type=date]', '1994-06-15');
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('.wbody input[type=number]')];
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(els[0], '172');
    set(els[1], '71.5');
  });
  await wait(250);
  await clickText(page, '下一步');
  await wait(350);

  // 第二步：选「维持」—— 不需要目标体重，最少的输入
  await clickText(page, '维持');
  await wait(250);
  await clickText(page, '下一步');
  await wait(350);

  // 第三步：先不用 AI
  await clickText(page, '先不用 AI');
  await wait(200);
  await clickText(page, '开始使用');

  await page.waitForSelector('.tabbar a', { timeout: 15000 });
  await wait(600);
  return true;
}
