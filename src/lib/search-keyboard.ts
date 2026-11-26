/**
 * 搜索结果的键盘导航（第 219 轮）。
 *
 * 站内搜索是一个浮层/页面上的结果列表，用键盘的人第一反应就是 ↓ ↓ Enter。
 * 之前只处理了 Tab 与 Esc：想打开第二条结果，只能一路 Tab 过去 ——
 * 对 1292 页的站来说，这个摩擦每天都会遇到。
 *
 * 这里把「按一下 ↓ 之后该高亮第几条」抽成纯函数，方便测；组件只管把 index 渲染出来。
 */

/** ↓/↑ 移动高亮项；到底了绕回开头，和浏览器地址栏的补全一致。 */
export function nextIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  const moved = current + delta;
  if (moved < 0) return length - 1;
  if (moved >= length) return 0;
  return moved;
}

/**
 * 回车时该打开哪一条：优先高亮项，没有高亮就用第一条。
 * 返回 null 表示"没有结果可开"，调用方应该什么都不做（不要阻止默认行为）。
 */
export function enterTarget(results: Array<{ url: string }>, activeIndex: number): string | null {
  if (results.length === 0) return null;
  const index = activeIndex >= 0 && activeIndex < results.length ? activeIndex : 0;
  return results[index]?.url ?? null;
}
