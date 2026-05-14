/**
 * AI 学习方向数据源：Hugging Face Daily Papers
 *
 * API：GET https://huggingface.co/api/daily_papers?date=YYYY-MM-DD
 *   返回每天精选论文（5-15 篇），含标题、作者、摘要、链接
 */

export type Paper = {
  source: "hf-daily" | "arxiv" | "openai-blog" | "lillog" | "anthropic" | "qbitai";
  title: string;
  authors: string[];
  url: string;          // 原文链接
  hfUrl: string;        // hf 详情页（blog 留空）
  abstract: string;     // 英文原始内容（abstract / blog 第一段）
  publishedAt?: string; // YYYY-MM-DD
  upvotes?: number;
};

export async function fetchHFDailyPapers(date?: string): Promise<Paper[]> {
  // 不传 date 则取最新一天
  const url = `https://huggingface.co/api/daily_papers${date ? `?date=${date}` : ""}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "zorotreeking-digest/1.0 (+https://www.zorotreeking.online)" },
  });
  if (!resp.ok) throw new Error(`HF daily papers ${resp.status}`);

  const raw = (await resp.json()) as Array<{
    paper?: {
      id?: string;
      title?: string;
      authors?: { name?: string }[];
      summary?: string;
      publishedAt?: string;
      upvotes?: number;
    };
  }>;

  return raw
    .map((it) => it.paper)
    .filter((p): p is NonNullable<typeof p> => !!p && !!p.id && !!p.title)
    .map((p) => ({
      source: "hf-daily" as const,
      title: (p.title ?? "").trim(),
      authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
      url: `https://arxiv.org/abs/${p.id}`,
      hfUrl: `https://huggingface.co/papers/${p.id}`,
      abstract: (p.summary ?? "").trim(),
      publishedAt: p.publishedAt?.slice(0, 10),
      upvotes: p.upvotes,
    }));
}
