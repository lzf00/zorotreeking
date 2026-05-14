/**
 * 量子位 QbitAI（中文 AI 资讯，WordPress 站点）
 *
 * WordPress REST API：GET /wp-json/wp/v2/posts?per_page=N
 *   返回标准 WP JSON，每篇含 title.rendered / content.rendered / excerpt.rendered / link / date
 */
import type { Paper } from "./ai.ts";

const UA = "zorotreeking-digest/1.0 Mozilla/5.0";

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&ldquo;|&rdquo;|&laquo;|&raquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchQbitAI(topN = 4): Promise<Paper[]> {
  const url = `https://www.qbitai.com/wp-json/wp/v2/posts?per_page=${topN}&orderby=date`;
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`qbitai ${resp.status}`);

  const data = (await resp.json()) as Array<{
    id?: number;
    date?: string;
    link?: string;
    title?: { rendered?: string };
    excerpt?: { rendered?: string };
    content?: { rendered?: string };
  }>;

  return data
    .filter((p) => p.title?.rendered && p.link)
    .map((p) => {
      const title = stripHtml(p.title!.rendered!);
      const excerpt = stripHtml(p.excerpt?.rendered ?? "");
      const content = stripHtml(p.content?.rendered ?? "").slice(0, 800);
      const abstract = excerpt && excerpt.length > 60 ? excerpt : content;
      return {
        source: "qbitai" as const,
        title,
        authors: ["量子位"],
        url: p.link!,
        hfUrl: "",
        abstract,
        publishedAt: p.date ? p.date.slice(0, 10) : undefined,
      };
    });
}
