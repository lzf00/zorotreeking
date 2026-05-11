import { getCollection } from "astro:content";
import type { APIContext } from "astro";

type Section = "ai" | "invest" | "hike" | "photo";

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

  const urls: { loc: string; lastmod?: Date }[] = [
    { loc: `${site}/` },
    { loc: `${site}/about` },
    { loc: `${site}/ai` },
    { loc: `${site}/invest` },
    { loc: `${site}/hike` },
    { loc: `${site}/photo` },
    { loc: `${site}/en/` },
    { loc: `${site}/en/about` },
    { loc: `${site}/en/ai` },
    { loc: `${site}/en/invest` },
    { loc: `${site}/en/hike` },
    { loc: `${site}/en/photo` },
  ];
  const push = (section: Section, lang: "zh" | "en", entries: any[]) => {
    for (const e of entries) {
      urls.push({
        loc: `${site}${lang === "en" ? "/en" : ""}/${section}/${e.data.translationKey}`,
        lastmod: e.data.updated ?? e.data.date,
      });
    }
  };
  push("ai", "zh", aiZh); push("ai", "en", aiEn);
  push("invest", "zh", invZh); push("invest", "en", invEn);
  push("hike", "zh", hikeZh); push("hike", "en", hikeEn);
  push("photo", "zh", photoZh); push("photo", "en", photoEn);

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
