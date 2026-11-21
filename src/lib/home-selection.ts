/**
 * 首页"精选阅读"与"最近更新"的挑选规则（第 101 轮）。
 *
 * 线上实测发现的问题：首屏第一张精选卡是 **2026-06-29** 的股票日报，而站点当天
 * 已经有 11-20 的内容。原因很直白 —— 「精选 选 1」的注释写的是"最近的原创长文"，
 * 代码却只按 `body.length` 排序，完全没有日期：涨停/跌停几十行表格的自动复盘
 * 永远是"最长的"，于是五个月的旧闻霸占了首屏。
 *
 * 顺带查清了一件事（属于内容策略，不是代码 bug）：这个站目前**几乎是 100% 自动化产出**。
 * ai 栏目 211 篇里 188 篇 digest + 22 篇 weekly + 1 篇 hello-world；
 * invest 栏目 311 篇里 188 篇 digest + 122 篇 market-recap + 1 篇月度复盘。
 * 所以"首页只展示手写长文"这个设想在数据上不成立 —— 那会把首页变成两篇占位文。
 * 因此这里**不隐藏**自动内容，只修「用日期兜住新鲜度」这一条。
 */

export interface SelectablePost {
  data: {
    tags?: string[];
    translationKey: string;
    date: Date;
  };
  body?: string | null;
}

/**
 * 「当天那一期」类内容：digest 日报。它有自己的位置（精选第 2 张卡），
 * 不参与"最长的原创长文"竞争，也不进"最近更新"（否则首页会变成日报列表）。
 */
export function isDailyDigest(post: SelectablePost): boolean {
  return (
    (post.data.tags ?? []).includes("digest") || post.data.translationKey.startsWith("digest-")
  );
}

/**
 * 精选头条的候选池：只在**最近这么多篇**非日报内容里挑最长的。
 * 用"篇数"而不是"天数"当窗口，是因为这个站的产出是每个交易日一篇复盘 ——
 * 20 篇大概覆盖最近一个月，既保证新鲜，又不会因为节假日断更而把池子清空。
 */
export const FEATURED_POOL_SIZE = 20;

/**
 * 首页候选的包装：`section` 决定卡片配色，`post` 是原始 content 条目。
 * 这里用宽松类型是刻意的 —— 四个 collection（ai/invest/photo/hike）的条目类型互不兼容，
 * 硬写成泛型会让调用处六个 `Sectioned<A>` vs `Sectioned<B>` 的类型报错（踩过了）。
 * 结构约束由 SelectablePost 在函数内部保证。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Sectioned {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post: any;
  section: string;
}

const byDateDesc = (a: Sectioned, b: Sectioned) =>
  b.post.data.date.getTime() - a.post.data.date.getTime();

/**
 * 精选阅读三张卡：
 *  1. 最近 FEATURED_POOL_SIZE 篇非日报内容里最长的一篇（先按日期截池子，再比长度 ——
 *     这样既不会像原来那样让五个月前的旧闻霸屏，也不会只剩占位文可选）
 *  2. 最新一期 digest
 *  3. 最新的摄影 / 徒步
 */
export function pickFeatured(input: { originals: Sectioned[]; digests: Sectioned[]; visuals: Sectioned[] }): Sectioned[] {
  const byLength = (items: Sectioned[]) =>
    [...items].sort(
      (a, b) => ((b.post as SelectablePost).body?.length ?? 0) - ((a.post as SelectablePost).body?.length ?? 0),
    );

  const pool = [...input.originals].sort(byDateDesc).slice(0, FEATURED_POOL_SIZE);
  const longest = (pool.length > 0 ? byLength(pool) : byLength(input.originals))[0];
  const latestDigest = [...input.digests].sort(byDateDesc)[0];
  const latestVisual = [...input.visuals].sort(byDateDesc)[0];

  return [longest, latestDigest, latestVisual].filter(Boolean) as Sectioned[];
}

/**
 * 首页"最近更新"：按日期倒序取前 N 条（自动复盘保留 —— 它们就是站点每天的真实产出），
 * 只把 digest 日报排除在外，因为日报有单独的入口。
 */
export function pickRecent(items: Sectioned[], limit = 6): Sectioned[] {
  return items.filter((item) => !isDailyDigest(item.post)).sort(byDateDesc).slice(0, limit);
}
