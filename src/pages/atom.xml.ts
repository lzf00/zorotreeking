/**
 * Atom 1.0 feed（与 rss.xml 并存）。
 * 部分阅读器 / 工具（NetNewsWire / Inoreader / 一些 Pocket alternatives）
 * 对 Atom 兼容更好。Atom 字段更全（updated 区分于 published，author 结构化）。
 */
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

const SITE_NAME = "ZoroTreeking";
const SITE_DESC = "AI · 投资 · 摄影 · 徒步";
const AUTHOR = { name: "Zifei Liu", uri: "https://github.com/lzf00" };

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(context: APIContext): Promise<Response> {
  const site = context.site!.toString().replace(/\/$/, "");
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

  const updated = all[0]?.data.date.toISOString() ?? new Date().toISOString();
  const feedId = `${site}/`;
  const entries = all.slice(0, 50).map((p) => {
    const link = `${site}/${p.section}/${p.data.translationKey}/`;
    const pub = p.data.date.toISOString();
    const upd = (p.data.updated ?? p.data.date).toISOString();
    const tags = (p.data.tags ?? [])
      .map((t) => `    <category term="${escapeXml(t)}" />`)
      .join("\n");
    return `  <entry>
    <id>${link}</id>
    <title type="text">${escapeXml(p.data.title)}</title>
    <link href="${link}" rel="alternate" />
    <published>${pub}</published>
    <updated>${upd}</updated>
${tags}
    <summary type="text">${escapeXml(p.data.description ?? "")}</summary>
  </entry>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">
  <id>${feedId}</id>
  <title>${escapeXml(SITE_NAME)}</title>
  <subtitle>${escapeXml(SITE_DESC)}</subtitle>
  <link href="${site}/atom.xml" rel="self" />
  <link href="${site}/" rel="alternate" />
  <updated>${updated}</updated>
  <author>
    <name>${escapeXml(AUTHOR.name)}</name>
    <uri>${AUTHOR.uri}</uri>
  </author>
  <generator uri="https://astro.build" version="4">Astro</generator>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
  });
}
