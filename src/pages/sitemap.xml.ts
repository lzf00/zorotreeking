import { getCollection } from "astro:content";
import type { APIContext } from "astro";
import stockDetails from "@/data/wind-stock-details.json";
import { travelGuides } from "@/data/travel-guides";
import { getStaticSitemapPaths } from "@/lib/sitemap";
import { tagToSlug } from "@/lib/tags";
import { escapeXml } from "@/lib/xml";

type Section = "ai" | "invest" | "hike" | "photo";

/**
 * 站点所有页面都以 `/` 结尾（nginx 对不带斜杠的地址 301 过去，canonical 也是带斜杠的）。
 * sitemap 以前漏了这个斜杠，1138 条 url 全是 301 中转：Search Console 里整份 sitemap
 * 都会被算成「网页会重定向」，爬取预算白烧（2026-11 加 check:seo 的 sitemap 校验时发现）。
 */
const withSlash = (path: string): string => (path.endsWith("/") ? path : `${path}/`);

export async function GET(context: APIContext) {
  const site = context.site!.toString().replace(/\/$/, "");
  const [aiZh, aiEn, invZh, invEn, hikeZh, hikeEn, photoZh, photoEn] = await Promise.all([
    getCollection("ai", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("ai", (p) => p.data.lang === "en" && !p.data.draft),
    getCollection("invest", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("invest", (p) => p.data.lang === "en" && !p.data.draft),
    getCollection("hike", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("hike", (p) => p.data.lang === "en" && !p.data.draft),
    getCollection("photo", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("photo", (p) => p.data.lang === "en" && !p.data.draft),
  ]);

  const urls: { loc: string; lastmod?: Date }[] = getStaticSitemapPaths()
    .map((path) => ({ loc: withSlash(`${site}${path}`) }));
  const push = (section: Section, lang: "zh" | "en", entries: any[]) => {
    for (const e of entries) {
      urls.push({
        loc: withSlash(`${site}${lang === "en" ? "/en" : ""}/${section}/${e.data.translationKey}`),
        lastmod: e.data.updated ?? e.data.date,
      });
    }
  };
  push("ai", "zh", aiZh); push("ai", "en", aiEn);
  push("invest", "zh", invZh); push("invest", "en", invEn);
  push("hike", "zh", hikeZh); push("hike", "en", hikeEn);
  push("photo", "zh", photoZh); push("photo", "en", photoEn);
  for (const guide of travelGuides) {
    urls.push({ loc: withSlash(`${site}${guide.href}`), lastmod: new Date(`${guide.updated ?? guide.date}T00:00:00+08:00`) });
  }

  const zhEntries = [...aiZh, ...invZh, ...hikeZh, ...photoZh];
  const enEntries = [...aiEn, ...invEn, ...hikeEn, ...photoEn];
  const pushTags = (lang: "zh" | "en", entries: typeof zhEntries) => {
    const tags = new Set(entries.flatMap((entry) => entry.data.tags ?? []).filter(Boolean));
    for (const tag of tags) {
      urls.push({ loc: withSlash(`${site}${lang === "en" ? "/en" : ""}/tag/${tagToSlug(tag)}`) });
    }
  };
  pushTags("zh", zhEntries);
  pushTags("en", enEntries);

  for (const code of Object.keys(stockDetails.stocks ?? {})) {
    urls.push({ loc: withSlash(`${site}/invest/stock/${encodeURIComponent(code)}`) });
    urls.push({ loc: withSlash(`${site}/en/invest/stock/${encodeURIComponent(code)}`) });
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
