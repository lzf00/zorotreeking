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
import { decodeVector, type StoredCache, type StoredVector } from "./embedding-codec";

export type EmbeddingCache = StoredCache;
const EMBEDDINGS = embeddingsData as EmbeddingCache;

// JSON 里存的是 int8+base64（16MB→1.4MB），解码成 Float32Array 后才算 cosine。
// 每次调用建一个局部 memo：一篇文章要跟 ~495 个候选比，不 memo 会重复解码。
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
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
  embeddingCache: EmbeddingCache = EMBEDDINGS,
): PostRef[] {
  const limit = Math.max(0, Math.floor(n));
  if (limit === 0) return [];

  const currentIsDigest = isDigestPost(current);
  const candidates = all
    .filter((p) => p.data.translationKey !== current.data.translationKey)
    .filter((p) => currentIsDigest || !isDigestPost(p));

  const items = embeddingCache.items ?? {};
  const vecMemo = new Map<string, Float32Array>();
  const vecOf = (key: string): Float32Array | undefined => {
    const hit = vecMemo.get(key);
    if (hit) return hit;
    const item: StoredVector | undefined = items[key];
    if (!item) return undefined;
    const vec = decodeVector(item);
    if (vec.length === 0) return undefined;
    vecMemo.set(key, vec);
    return vec;
  };
  const curKey = `${current.collection}/${current.data.translationKey}`;
  const curVec = vecOf(curKey) ?? new Float32Array(0);
  const selected: PostLike[] = [];
  const selectedKeys = new Set<string>();
  const addSelected = (post: PostLike) => {
    const key = `${post.collection}/${post.data.translationKey}`;
    if (selectedKeys.has(key) || selected.length >= limit) return;
    selectedKeys.add(key);
    selected.push(post);
  };

  // ── 优先 embedding ──
  if (curVec && curVec.length > 0) {
    const semantic = candidates
      .map((p) => {
        const v = vecOf(`${p.collection}/${p.data.translationKey}`);
        const sim = v ? cosine(curVec, v) : -1;
        return { p, sim, ts: p.data.date.getTime() };
      })
      .filter((x) => x.sim > 0)
      .sort((a, b) => b.sim - a.sim || b.ts - a.ts)
      .slice(0, limit);
    semantic.forEach((item) => addSelected(item.p));
    if (selected.length >= limit) return selected.map(toRef);
    // 不够 N 篇 → 保留语义结果，再用 tag 算法补
  }

  // ── Fallback：tag overlap ──
  const currentTags = new Set(current.data.tags ?? []);
  const tagged = candidates
    .filter((p) => !selectedKeys.has(`${p.collection}/${p.data.translationKey}`))
    .map((p) => {
      const overlap = (p.data.tags ?? []).filter((t) => currentTags.has(t)).length;
      return { p, overlap, ts: p.data.date.getTime() };
    })
    .filter((x) => x.overlap > 0 || currentTags.size === 0)
    .sort((a, b) => b.overlap - a.overlap || b.ts - a.ts)
    .slice(0, limit - selected.length);
  tagged.forEach((item) => addSelected(item.p));

  // 仍不够 → 按时间补
  if (selected.length < limit) {
    const filler = candidates
      .filter((p) => !selectedKeys.has(`${p.collection}/${p.data.translationKey}`))
      .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
      .slice(0, limit - selected.length);
    filler.forEach(addSelected);
  }

  return selected.map(toRef);
}
