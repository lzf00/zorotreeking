/**
 * Yahoo Finance RSS（英文市场资讯，需要 LLM 翻译）
 *
 * 端点：https://finance.yahoo.com/rss/
 *   返回标准 RSS 2.0，覆盖美股/全球市场新闻
 */
import { XMLParser } from "fast-xml-parser";
import type { NewsItem } from "./invest.ts";

const UA = "zorotreeking-digest/1.0 Mozilla/5.0";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchYahooFinance(topN = 3): Promise<NewsItem[]> {
  const resp = await fetch("https://finance.yahoo.com/rss/", {
    headers: { "User-Agent": UA },
  });
  if (!resp.ok) throw new Error(`yahoo ${resp.status}`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: "__cdata",
    processEntities: false,
  });
  const data = parser.parse(await resp.text());
  const items = data?.rss?.channel?.item ?? [];
  const list = Array.isArray(items) ? items : [items];

  return list
    .map((it: any) => {
      const get = (v: any): string => {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (v.__cdata) return String(v.__cdata);
        return String(v);
      };
      return {
        source: "yahoo-finance" as const,
        title: stripHtml(get(it.title)).trim(),
        digest: stripHtml(get(it.description)).slice(0, 500),
        url: get(it.link).trim(),
        publishedAt: it.pubDate ? new Date(String(it.pubDate)).toISOString() : new Date().toISOString(),
        tags: [],
        stocks: [],
      };
    })
    .filter((it) => it.title && it.url)
    .slice(0, topN);
}
