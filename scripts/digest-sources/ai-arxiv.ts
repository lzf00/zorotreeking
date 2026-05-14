/**
 * arxiv cs.LG（机器学习类）每日新论文 RSS
 *
 * 端点：http://export.arxiv.org/rss/cs.LG
 *   返回当日新提交+更新的 cs.LG 论文（通常 50-200 篇）。
 *   只取前 N 篇（按 RSS 排序，最新优先）。
 */
import { XMLParser } from "fast-xml-parser";
import type { Paper } from "./ai.ts";

type ArxivCat = "cs.LG" | "cs.CL" | "cs.AI" | "cs.CV";

export async function fetchArxivRSS(category: ArxivCat = "cs.LG", topN = 6): Promise<Paper[]> {
  const url = `http://export.arxiv.org/rss/${category}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "zorotreeking-digest/1.0" },
  });
  if (!resp.ok) throw new Error(`arxiv ${category} ${resp.status}`);

  const xml = await resp.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
  });
  const data = parser.parse(xml);

  // RSS 2.0 结构：rdf:RDF > item[]，或 rss > channel > item[]
  const items: any[] = data?.["rdf:RDF"]?.item ?? data?.rss?.channel?.item ?? [];
  const list = Array.isArray(items) ? items : [items];

  return list
    .slice(0, topN)
    .map((it) => {
      // RSS title 通常是 "Title (arXiv:2605.01234v1 [cs.LG])"
      const rawTitle: string = it.title?.__cdata ?? it.title ?? "";
      const titleMatch = rawTitle.match(/^(.+?)\s*\(arXiv:([\w.]+)/);
      const title = titleMatch ? titleMatch[1].trim() : rawTitle.trim();
      const arxivId = titleMatch ? titleMatch[2] : "";
      // description 是 abstract（可能含 <p> 标签）
      const rawDesc: string = it.description?.__cdata ?? it.description ?? "";
      const abstract = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const link = it.link ?? "";
      const authorsRaw: string = it["dc:creator"]?.__cdata ?? it["dc:creator"] ?? "";
      const authors = authorsRaw
        .replace(/<[^>]+>/g, "")
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        source: "arxiv" as const,
        title,
        authors,
        url: link || (arxivId ? `https://arxiv.org/abs/${arxivId}` : ""),
        hfUrl: arxivId ? `https://huggingface.co/papers/${arxivId}` : "",
        abstract,
        publishedAt: undefined,
        upvotes: undefined,
      } satisfies Paper;
    })
    .filter((p) => p.title && p.abstract);
}
