/**
 * Anthropic News（无官方 RSS）
 *
 * 策略：
 *   1. 抓 https://www.anthropic.com/news 索引页 HTML
 *   2. 用正则提取 /news/<slug> 链接 + 文章卡片上的发布日期
 *   3. 取每个文章的标题（已经在 HTML 文本里）
 *
 *   Anthropic 不在文章卡片暴露 abstract，所以我们逐个 fetch 详情页拿 OG description。
 *   为限制成本，只抓前 N 个看起来"最新"的。
 */
import type { Paper } from "./ai.ts";

const UA = "zorotreeking-digest/1.0 Mozilla/5.0 (X11; Linux x86_64)";

function extractFirstMeta(html: string, property: string): string {
  const re = new RegExp(
    `<meta\\s+(?:property|name)="${property}"\\s+content="([^"]+)"`,
    "i",
  );
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

function htmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export async function fetchAnthropicNews(topN = 3): Promise<Paper[]> {
  const indexResp = await fetch("https://www.anthropic.com/news", {
    headers: { "User-Agent": UA },
  });
  if (!indexResp.ok) throw new Error(`anthropic index ${indexResp.status}`);
  const indexHtml = await indexResp.text();

  // 抓所有 /news/<slug> 链接，按出现顺序去重
  const slugs: string[] = [];
  const seen = new Set<string>();
  const re = /href="(\/news\/[a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexHtml)) !== null) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= topN) break;
  }

  const out: Paper[] = [];
  for (const slug of slugs) {
    try {
      const url = `https://www.anthropic.com${slug}`;
      const resp = await fetch(url, { headers: { "User-Agent": UA } });
      if (!resp.ok) continue;
      const html = await resp.text();
      const title = htmlDecode(extractFirstMeta(html, "og:title")).replace(/\s+\\?\s*Anthropic\s*$/i, "");
      const description = htmlDecode(extractFirstMeta(html, "og:description"));
      const ogDate =
        extractFirstMeta(html, "article:published_time") ||
        extractFirstMeta(html, "pubdate") ||
        "";
      if (!title) continue;
      out.push({
        source: "anthropic" as const,
        title: title.trim(),
        authors: ["Anthropic"],
        url,
        hfUrl: "",
        abstract: description.trim() || title.trim(),
        publishedAt: ogDate ? ogDate.slice(0, 10) : undefined,
      });
    } catch {
      // 单篇失败跳过
    }
  }
  return out;
}
