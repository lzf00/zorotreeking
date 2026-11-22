/**
 * 接口全挂时，页面还该是个页面（第 166 轮）。
 *
 * 这个站点的接口全都藏在"前端静默降级"后面：`/api/market/*`、`/api/feedback`、
 * `/api/track`。降级做得好，用户看到的是"这块暂时没有数据"；做得不好，用户看到
 * 空白、NaN、或者一句话都没有的错误页 —— 而**所有现有检查都只测接口通的时候**
 * （check:runtime 用 200 桩，部署后 smoke 也只打真实接口）。
 *
 * 判定只看"页面还能不能读"，不看接口：
 *   · 页面自身 HTTP 200（静态产物不该被接口拖垮）
 *   · 没有未捕获的 JS 异常（红屏）
 *   · 有主标题、正文长度足够（不是白屏）
 *   · 可见文字里没有 undefined / NaN / [object Object] 这类渲染事故痕迹
 */
export function evaluatePage({ status, pageErrors = [], text = "", heading = "", apiFailures = [] }) {
  const problems = [];
  if (status !== 200) problems.push(`页面自身 HTTP ${status}`);
  for (const error of pageErrors.slice(0, 3)) problems.push(`未捕获 JS 异常：${error}`);
  if (!heading) problems.push("没有主标题（白屏或模板没渲染）");
  // 150 字的来历：/photo/ 是"以图为主"的相册索引，正文只有 256 字，但那 256 字是真的内容。
  // 玄学阈值会把好页面判死，所以照实测基线往下留一点余量，只抓"基本空"的页面。
  if (text.trim().length < 150) problems.push(`正文只有 ${text.trim().length} 字（疑似白屏）`);
  for (const token of ["undefined", "NaN", "[object Object]"]) {
    if (text.includes(token)) problems.push(`可见文字里出现渲染事故痕迹「${token}」`);
  }
  // 接口失败本身不是问题（这正是被测场景），但必须真的失败过，否则这条检查是空转
  if (apiFailures.length === 0) problems.push("没有观察到任何接口失败 —— 桩没生效，检查不可信");
  return { ok: problems.length === 0, problems };
}
