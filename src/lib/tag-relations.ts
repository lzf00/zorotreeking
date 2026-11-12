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
