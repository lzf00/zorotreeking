/**
 * 标签页的纯逻辑：slug 生成、共现标签、跨板块统计。
 *
 * 放在这里而不是 `tags.ts`，是因为 `tags.ts` 依赖 `astro:content`（只能在 Astro 构建期加载），
 * 而这些函数是纯数据计算，抽出来才能被 `node --test` 直接覆盖。
 */

export type TaggedPost = {
  section: "ai" | "invest" | "photo" | "hike";
  tags: string[];
};

/** 用于 URL 的稳定 slug：保留中英文与数字，空白替换成 - */
export function tagToSlug(tag: string): string {
  return encodeURIComponent(tag.trim().replace(/\s+/g, "-"));
}

/**
 * 同一个标签下的文章还带哪些别的标签，按共现次数排序。
 *
 * 标签页正文原本只有一行「N 篇」加一个列表，正文不到 40 词，搜索引擎基本当成空页面。
 * 把「一起出现的标签」做成链接，既补了正文，也让标签页之间第一次有了横向入口
 * （在此之前只能退回 /tag 总览）。
 */
export function relatedTags(tag: string, posts: TaggedPost[], limit = 6) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const other of post.tags) {
      if (!other || other === tag) continue;
      counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ tag: name, slug: tagToSlug(name), count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** 标签下的文章分布在哪些板块，用来写「这个标签横跨了哪几个栏目」 */
export function tagSections(posts: TaggedPost[]) {
  const order = ["ai", "invest", "photo", "hike"] as const;
  const seen = new Set(posts.map((p) => p.section));
  return order.filter((section) => seen.has(section));
}

/**
 * 标签页的「时间跨度 + 板块分布」统计。
 *
 * 目的和 `relatedTags` 一样：让标签页正文有实质信息量而不是一行计数——读者想知道
 * 这个标签是不是还在更新、主要落在哪个栏目。日期格式化放在页面里做（要按语言），
 * 这里只负责算。
 */
export function tagStats<T extends TaggedPost & { date: Date }>(posts: T[]) {
  const bySection = {} as Partial<Record<TaggedPost["section"], number>>;
  let newest: Date | null = null;
  let oldest: Date | null = null;
  for (const post of posts) {
    bySection[post.section] = (bySection[post.section] ?? 0) + 1;
    const t = post.date instanceof Date ? post.date.getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    if (newest === null || t > newest.getTime()) newest = new Date(t);
    if (oldest === null || t < oldest.getTime()) oldest = new Date(t);
  }
  const month = (d: Date | null) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : undefined);
  return { from: month(oldest), to: month(newest), bySection };
}

/**
 * 标签页 ItemList 结构化数据的条数上限。
 *
 * `/tag/auto/` 一个页面挂着 385 条内容（348 KB），其中 ItemList 的 JSON 占了四十多 KB。
 * 搜索引擎只读列表开头的一批，没必要把整页都塞进结构化数据；列表本身仍然完整渲染，
 * 所以对读者没有损失。
 */
export const MAX_TAG_ITEMLIST = 100;
