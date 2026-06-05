/**
 * 文章页尾巴用的两类推荐：
 *   1) prev/next：同 collection 内按时间相邻的上一篇/下一篇
 *   2) related：按 tag overlap 在同 collection 内找 3 篇最相关的
 */

interface PostLike {
  data: { date: Date; tags?: string[]; translationKey: string; title: string; description?: string };
  body: string;
  collection: string;
}

export interface PostRef {
  translationKey: string;
  title: string;
  description?: string;
  date: Date;
  tags: string[];
}

function toRef(p: PostLike): PostRef {
  return {
    translationKey: p.data.translationKey,
    title: p.data.title,
    description: p.data.description,
    date: p.data.date,
    tags: p.data.tags ?? [],
  };
}

/**
 * 从同 collection 找时间上的前后篇。按 date 降序排：
 *   prev = 比当前更早一篇（更早的 = 数组中位置 +1 因为降序）
 *   next = 比当前更晚一篇
 */
export function getAdjacentPosts(
  current: PostLike,
  all: PostLike[],
): { prev?: PostRef; next?: PostRef } {
  const sorted = [...all].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
  const i = sorted.findIndex((p) => p.data.translationKey === current.data.translationKey);
  if (i < 0) return {};
  return {
    next: i > 0 ? toRef(sorted[i - 1]) : undefined,
    prev: i < sorted.length - 1 ? toRef(sorted[i + 1]) : undefined,
  };
}

/**
 * 找 N 篇最相关的文章。规则：
 *   - 必须同 collection
 *   - 必须不是自己
 *   - 相关性 = tag overlap 数量；并列时取更近期
 *   - 排除 digest 类（避免天天推 digest 没意义）
 */
export function getRelatedPosts(
  current: PostLike,
  all: PostLike[],
  n: number = 3,
): PostRef[] {
  const currentTags = new Set(current.data.tags ?? []);
  const isDigest = (p: PostLike) =>
    (p.data.tags ?? []).includes("digest") || p.data.translationKey.startsWith("digest-");
  const currentIsDigest = isDigest(current);

  const scored = all
    .filter((p) => p.data.translationKey !== current.data.translationKey)
    // 如果当前是 digest，可以推 digest（按系列）；当前是原创，不要混 digest
    .filter((p) => currentIsDigest || !isDigest(p))
    .map((p) => {
      const overlap = (p.data.tags ?? []).filter((t) => currentTags.has(t)).length;
      return { p, overlap, ts: p.data.date.getTime() };
    })
    // 至少 1 个 tag 重合，或当前没有 tag 时按近期补
    .filter((x) => x.overlap > 0 || currentTags.size === 0)
    .sort((a, b) => b.overlap - a.overlap || b.ts - a.ts)
    .slice(0, n);

  // 如果不够 N 篇，用同 collection 的最近文章补
  if (scored.length < n) {
    const have = new Set(scored.map((x) => x.p.data.translationKey));
    const filler = all
      .filter((p) =>
        p.data.translationKey !== current.data.translationKey &&
        !have.has(p.data.translationKey) &&
        (currentIsDigest || !isDigest(p)),
      )
      .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
      .slice(0, n - scored.length);
    for (const p of filler) scored.push({ p, overlap: 0, ts: p.data.date.getTime() });
  }

  return scored.map((x) => toRef(x.p));
}
