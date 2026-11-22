/**
 * 横向溢出判定（第 164 轮）。
 *
 * 为什么要有它：CLS / LCP 都测不到"**页面比屏幕宽**"这种坏法。手机上多出 3px
 * 就意味着整页可以左右晃、或者某个长 URL / 宽表格把布局顶开 —— 而 axe 的无障碍扫描、
 * 我们自己的 vitals 全都不会报。这类问题只会在真机上被人看见。
 *
 * 实测基线（2026-11-22，18 个关键模板 × 390/1280 两个宽度）：全部 0px。
 * 所以阈值取 1px（亚像素取整误差），超过就是真的坏了。
 */

/**
 * @param {{scrollWidth: number, clientWidth: number}} m
 * @returns {{overflow: number, ok: boolean}}
 */
export function overflowOf(m) {
  const overflow = Math.max(0, Math.round((m?.scrollWidth ?? 0) - (m?.clientWidth ?? 0)));
  return { overflow, ok: overflow <= 1 };
}

/** 给人看的结论：带上"最宽的元素"，否则只知道超了几像素没法查。 */
export function describeOverflow({ overflow, worst }) {
  if (overflow <= 1) return null;
  const where = worst ? `；最宽的元素 <${worst.tag}> .${worst.cls} 超出 ${worst.over}px` : "";
  return `横向溢出 +${overflow}px${where}`;
}
