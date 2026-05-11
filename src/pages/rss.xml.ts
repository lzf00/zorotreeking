import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const [ai, invest, hike, photo] = await Promise.all([
    getCollection("ai", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("invest", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("hike", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("photo", (p) => p.data.lang === "zh" && !p.data.draft),
  ]);
  const sectionOf = (k: string) => k.startsWith("ai") ? "ai" : k.startsWith("invest") ? "invest" : k.startsWith("hike") ? "hike" : "photo";
  const all = [
    ...ai.map((p) => ({ ...p, section: "ai" as const })),
    ...invest.map((p) => ({ ...p, section: "invest" as const })),
    ...hike.map((p) => ({ ...p, section: "hike" as const })),
    ...photo.map((p) => ({ ...p, section: "photo" as const })),
  ].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: "ZoroTreeking",
    description: "AI · 投资 · 摄影 · 徒步",
    site: context.site!,
    items: all.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      description: p.data.description ?? "",
      link: `/${p.section}/${p.data.translationKey}`,
      categories: p.data.tags,
    })),
    customData: `<language>zh-CN</language>`,
  });
}
