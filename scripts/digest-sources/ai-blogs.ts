/**
 * AI 厂商 / 个人博客 RSS 抓取
 *
 *   - OpenAI News：每周 1-3 篇官方动态（产品发布、研究 blog 等）
 *   - Lil'Log（Lilian Weng）：每月 0-2 篇高质量技术长文
 *
 * 都是英文，由后续 LLM 步骤翻译成中文摘要。
 */
import { XMLParser } from "fast-xml-parser";
import type { Paper } from "./ai.ts";

const UA = "zorotreeking-digest/1.0 Mozilla/5.0";

function parseRssItems(xml: string): Array<{
  title: string;
  link: string;
  description: string;
  content: string;
  pubDate?: string;
  author?: string;
}> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: "__cdata",
    processEntities: false,  // Lil'Log 等长文 entity 数易超 1000 默认限制；自己用 stripHtml 兜底
  });
  const data = parser.parse(xml);
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
        title: get(it.title).trim(),
        link: get(it.link).trim(),
        description: get(it.description).trim(),
        content: get(it["content:encoded"]).trim(),
        pubDate: it.pubDate ? String(it.pubDate) : undefined,
        author: it["dc:creator"] ? String(it["dc:creator"]) : undefined,
      };
    })
    .filter((it) => it.title);
}

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
    .replace(/\s+/g, " ")
    .trim();
}

function isRecent(pubDateStr: string | undefined, daysBack: number): boolean {
  if (!pubDateStr) return true; // 没日期就不过滤
  const t = Date.parse(pubDateStr);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= daysBack * 24 * 3600 * 1000;
}

// ── OpenAI 官方动态 RSS ────────────────────────────────
export async function fetchOpenAIBlog(daysBack = 14, topN = 3): Promise<Paper[]> {
  const resp = await fetch("https://openai.com/blog/rss.xml", {
    headers: { "User-Agent": UA },
  });
  if (!resp.ok) throw new Error(`openai blog ${resp.status}`);
  const items = parseRssItems(await resp.text());
  return items
    .filter((it) => isRecent(it.pubDate, daysBack))
    .slice(0, topN)
    .map((it) => {
      const body = it.content || it.description || "";
      const abstract = stripHtml(body).slice(0, 800);
      return {
        source: "openai-blog" as const,
        title: it.title,
        authors: ["OpenAI"],
        url: it.link,
        hfUrl: "",
        abstract,
        publishedAt: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : undefined,
      };
    })
    .filter((p) => p.title && p.url);
}

// ── Lil'Log（Lilian Weng）RSS ──────────────────────────
export async function fetchLilLog(daysBack = 90, topN = 2): Promise<Paper[]> {
  const resp = await fetch("https://lilianweng.github.io/index.xml", {
    headers: { "User-Agent": UA },
  });
  if (!resp.ok) throw new Error(`lillog ${resp.status}`);
  const items = parseRssItems(await resp.text());
  return items
    .filter((it) => isRecent(it.pubDate, daysBack))
    .slice(0, topN)
    .map((it) => {
      const body = it.content || it.description || "";
      const abstract = stripHtml(body).slice(0, 800);
      return {
        source: "lillog" as const,
        title: it.title,
        authors: ["Lilian Weng"],
        url: it.link,
        hfUrl: "",
        abstract,
        publishedAt: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : undefined,
      };
    })
    .filter((p) => p.title && p.url);
}
