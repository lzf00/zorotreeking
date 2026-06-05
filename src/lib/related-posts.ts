/**
 * 文章页尾巴用的两类推荐：
 *   1) prev/next：同 collection 内按时间相邻的上一篇/下一篇
 *   2) related：优先用 LLM embedding cosine 相似度找最相关的，
 *      缺 embedding 时 fallback tag overlap
 *
 * Embedding 数据：src/data/embeddings.json（由 scripts/generate-embeddings.ts
 * 在 daily-digest cron 中维护，每篇 mdx 一个 doubao-embedding 向量）
 */
import embeddingsData from "../data/embeddings.json";

interface EmbeddingCache {
  model?: string;
  dim?: number;
  items?: Record<string, { hash: string; vec: number[] }>;
}
const EMBEDDINGS = embeddingsData as EmbeddingCache;

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

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

const isDigestPost = (p: PostLike) =>
  (p.data.tags ?? []).includes("digest") || p.data.translationKey.startsWith("digest-");

/**
 * 找 N 篇最相关的文章。
 *
 * 优先用 LLM embedding cosine 相似度（语义匹配，质量好得多）；
 * 缺 embedding 时 fallback 到 tag overlap。
 *
 * 规则：
 *   - 不是自己
 *   - 当前是 digest → 可以推 digest（按系列）；当前是原创 → 不混 digest
 *   - 不限制同 collection（embedding 已经能跨主题找近邻；
 *     比如 AI 论文可能跟一篇技术博客高度相关）
 */
export function getRelatedPosts(
  current: PostLike,
  all: PostLike[],
  n: number = 3,
): PostRef[] {
  const currentIsDigest = isDigestPost(current);
  const candidates = all
    .filter((p) => p.data.translationKey !== current.data.translationKey)
    .filter((p) => currentIsDigest || !isDigestPost(p));

  const items = EMBEDDINGS.items ?? {};
  const curKey = `${current.collection}/${current.data.translationKey}`;
  const curVec = items[curKey]?.vec;

  // ── 优先 embedding ──
  if (curVec && curVec.length > 0) {
    const scored = candidates
      .map((p) => {
        const k = `${p.collection}/${p.data.translationKey}`;
        const v = items[k]?.vec;
        const sim = v ? cosine(curVec, v) : -1;
        return { p, sim, ts: p.data.date.getTime() };
      })
      .filter((x) => x.sim > 0)
      .sort((a, b) => b.sim - a.sim || b.ts - a.ts)
      .slice(0, n);
    if (scored.length >= n) return scored.map((x) => toRef(x.p));
    // 不够 N 篇 → 跌回 tag 算法补
  }

  // ── Fallback：tag overlap ──
  const currentTags = new Set(current.data.tags ?? []);
  const scored = candidates
    .map((p) => {
      const overlap = (p.data.tags ?? []).filter((t) => currentTags.has(t)).length;
      return { p, overlap, ts: p.data.date.getTime() };
    })
    .filter((x) => x.overlap > 0 || currentTags.size === 0)
    .sort((a, b) => b.overlap - a.overlap || b.ts - a.ts)
    .slice(0, n);

  // 仍不够 → 按时间补
  if (scored.length < n) {
    const have = new Set(scored.map((x) => x.p.data.translationKey));
    const filler = candidates
      .filter((p) => !have.has(p.data.translationKey))
      .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
      .slice(0, n - scored.length);
    for (const p of filler) scored.push({ p, overlap: 0, ts: p.data.date.getTime() });
  }

  return scored.map((x) => toRef(x.p));
}
