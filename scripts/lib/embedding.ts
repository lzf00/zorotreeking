/**
 * 豆包 / 火山方舟 embedding 调用。
 * 与 llm.ts 同账号，复用 DOUBAO_API_KEY / ARK_API_KEY。
 *
 * 模型：doubao-embedding-large-text-240915（2048 维）
 * 价格：~¥0.0007/k tokens，相关推荐用够便宜
 *
 * 用途：scripts/generate-embeddings.ts 给每篇文章算向量，存 src/data/embeddings.json，
 * 前端 lib/related-posts.ts 加载后算 cosine 相似度。
 */

const EMBED_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings";
const EMBED_MODEL = "doubao-embedding-large-text-240915";

export async function embed(text: string, opts: { timeoutMs?: number } = {}): Promise<number[]> {
  const apiKey = process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("DOUBAO_API_KEY (or ARK_API_KEY) not set");

  // 豆包 embedding 单条输入上限约 4k tokens，~12k 中文字符；超长截断
  const input = text.length > 4000 ? text.slice(0, 4000) : text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  try {
    const resp = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: [input],
        encoding_format: "float",
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`embed API ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { data?: { embedding?: number[] }[] };
    const vec = data.data?.[0]?.embedding;
    if (!vec || vec.length === 0) throw new Error("empty embedding from API");
    return vec;
  } finally {
    clearTimeout(timer);
  }
}

/** 简单按 sha256 算内容指纹，作为 cache key。 */
export async function contentHash(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
