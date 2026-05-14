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

type FeedItem = {
  title: string;
  link: string;
  description: string;
  content: string;
  pubDate?: string;
  author?: string;
};

function unwrap(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (v.__cdata) return String(v.__cdata);
  if (v["#text"]) return String(v["#text"]);
  return String(v);
}

/** 兼容 RSS 2.0（<item>）和 Atom（<entry>）两种 feed 格式 */
function parseRssItems(xml: string): FeedItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
    processEntities: false,
  });
  const data = parser.parse(xml);

  // RSS 2.0
  const rssItems = data?.rss?.channel?.item;
  if (rssItems) {
    const list = Array.isArray(rssItems) ? rssItems : [rssItems];
    return list
      .map((it: any) => ({
        title: unwrap(it.title).trim(),
        link: unwrap(it.link).trim(),
        description: unwrap(it.description).trim(),
        content: unwrap(it["content:encoded"]).trim(),
        pubDate: it.pubDate ? String(it.pubDate) : undefined,
        author: it["dc:creator"] ? String(it["dc:creator"]) : undefined,
      }))
      .filter((it) => it.title);
  }

  // Atom
  const atomEntries = data?.feed?.entry;
  if (atomEntries) {
    const list = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    return list
      .map((it: any) => {
        // Atom <link> 可能是单个对象 / 数组 / 字符串
        let link = "";
        const linkField = it.link;
        if (typeof linkField === "string") {
          link = linkField;
        } else if (Array.isArray(linkField)) {
          const alt = linkField.find((l) => l["@_rel"] === "alternate" || !l["@_rel"]);
          link = alt?.["@_href"] || linkField[0]?.["@_href"] || "";
        } else if (linkField && typeof linkField === "object") {
          link = linkField["@_href"] || "";
        }
        const author =
          (it.author?.name && unwrap(it.author.name)) ||
          (typeof it.author === "string" ? it.author : "") ||
          "";
        return {
          title: unwrap(it.title).trim(),
          link: link.trim(),
          description: unwrap(it.summary).trim(),
          content: unwrap(it.content).trim(),
          pubDate: it.published || it.updated || undefined,
          author,
        };
      })
      .filter((it) => it.title);
  }

  return [];
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
  return fetchSimpleBlog({
    url: "https://lilianweng.github.io/index.xml",
    source: "lillog",
    author: "Lilian Weng",
    daysBack,
    topN,
  });
}

// ── The Gradient（AI 长文期刊） ────────────────────────
export async function fetchTheGradient(daysBack = 120, topN = 2): Promise<Paper[]> {
  return fetchSimpleBlog({
    url: "https://thegradient.pub/rss/",
    source: "thegradient",
    author: "The Gradient",
    daysBack,
    topN,
  });
}

// ── Google Research Blog（Atom 格式） ─────────────────
export async function fetchGoogleResearch(daysBack = 21, topN = 2): Promise<Paper[]> {
  return fetchSimpleBlog({
    url: "https://blog.research.google/feeds/posts/default?alt=rss",
    source: "google-research",
    author: "Google Research",
    daysBack,
    topN,
  });
}

// ── DeepMind Blog ─────────────────────────────────────
export async function fetchDeepMind(daysBack = 30, topN = 2): Promise<Paper[]> {
  return fetchSimpleBlog({
    url: "https://deepmind.google/blog/rss.xml",
    source: "deepmind",
    author: "Google DeepMind",
    daysBack,
    topN,
  });
}

// ── Hugging Face Blog（非 Daily Papers，另一个频道） ────
export async function fetchHFBlog(daysBack = 14, topN = 2): Promise<Paper[]> {
  return fetchSimpleBlog({
    url: "https://huggingface.co/blog/feed.xml",
    source: "hf-blog",
    author: "Hugging Face",
    daysBack,
    topN,
  });
}

// ── 共用：简单 RSS/Atom 博客抓取 ─────────────────────
async function fetchSimpleBlog(opts: {
  url: string;
  source: Paper["source"];
  author: string;
  daysBack: number;
  topN: number;
}): Promise<Paper[]> {
  const resp = await fetch(opts.url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`${opts.source} ${resp.status}`);
  const items = parseRssItems(await resp.text());
  return items
    .filter((it) => isRecent(it.pubDate, opts.daysBack))
    .slice(0, opts.topN)
    .map((it) => {
      const body = it.content || it.description || "";
      const abstract = stripHtml(body).slice(0, 800);
      return {
        source: opts.source,
        title: it.title,
        authors: [opts.author],
        url: it.link,
        hfUrl: "",
        abstract,
        publishedAt: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : undefined,
      };
    })
    .filter((p) => p.title && p.url);
}
