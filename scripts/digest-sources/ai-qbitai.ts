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

// 量子位偶尔会发软广 / 跨界资讯（汽车、足球、电商）。
// 这里按标题做粗筛——命中任意关键词就跳过。
const BLACKLIST = [
  "比亚迪", "蔚来", "理想汽车", "小鹏",
  "足球", "篮球", "奥运", "世界杯",
  "618", "双 11", "双十一", "电商", "直播带货",
  "新车", "续航", "百公里", "马力", "驾驶", "城市 NOA",
  "新片", "电影", "票房", "综艺",
  "招聘", "面试题",
];

function isBlacklisted(title: string): boolean {
  const t = title.toLowerCase();
  return BLACKLIST.some((kw) => t.includes(kw.toLowerCase()));
}

export async function fetchQbitAI(topN = 4): Promise<Paper[]> {
  // 多拉几篇当 buffer，过滤后再截 topN。
  const fetchN = Math.max(topN * 3, 12);
  const url = `https://www.qbitai.com/wp-json/wp/v2/posts?per_page=${fetchN}&orderby=date`;
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
    .filter((p) => !isBlacklisted(stripHtml(p.title!.rendered!)))
    .slice(0, topN)
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
