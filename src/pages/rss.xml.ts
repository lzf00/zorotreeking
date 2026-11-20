import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

/**
 * RSS 2.0 feed。
 *
 * 第 57 轮审计发现的问题：
 *  - 缺少 `atom:link rel="self"`：聚合器没法确认「这份 feed 的规范地址」，去重和刷新都不稳；
 *  - 缺少 `lastBuildDate`：阅读器只能靠条目时间猜，配合 `ttl` 一起给；
 *  - 一次输出 526 条（260 KB）：RSS 是每次刷新都整份重传的格式，历史条目阅读器本地已有，
 *    所以和 atom.xml 对齐成最近 50 条（阅读器按 guid 保留旧条目，不会丢）。
 */
const MF_MAX_ITEMS = 50;

export async function GET(context: APIContext) {
  const [ai, invest, hike, photo] = await Promise.all([
    getCollection("ai", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("invest", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("hike", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("photo", (p) => p.data.lang === "zh" && !p.data.draft),
  ]);
  const all = [
    ...ai.map((p) => ({ ...p, section: "ai" as const })),
    ...invest.map((p) => ({ ...p, section: "invest" as const })),
    ...hike.map((p) => ({ ...p, section: "hike" as const })),
    ...photo.map((p) => ({ ...p, section: "photo" as const })),
  ].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const latest = all[0]?.data.date ?? new Date();
  const selfUrl = new URL("/rss.xml", context.site).toString();

  return rss({
    title: "ZoroTreeking",
    description: "AI · 投资 · 摄影 · 徒步旅行",
    site: context.site!,
    items: all.slice(0, MF_MAX_ITEMS).map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      description: p.data.description ?? "",
      link: `/${p.section}/${p.data.translationKey}`,
      categories: p.data.tags,
    })),
    customData:
      `<language>zh-CN</language>` +
      `<lastBuildDate>${latest.toUTCString()}</lastBuildDate>` +
      `<ttl>60</ttl>` +
      `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${selfUrl}" rel="self" type="application/rss+xml"/>`,
  });
}
