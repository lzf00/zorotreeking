/**
 * 非文章页的面包屑推导。
 *
 * 文章页的 BreadcrumbList 由 `Breadcrumb.astro` 输出（视觉面包屑 + JSON-LD 一起）。
 * 标签页、板块首页、相册、个股页、静态页此前只有一条裸 WebPage，没有面包屑——
 * Google 因此看不出这些页面在站点层级里的位置，SERP 也拿不到面包屑富结果。
 *
 * 这里按 URL 结构推导：首段命中已知栏目就插一级栏目，`/tag/x/` 额外插「全部标签」，
 * 其余情况只有「首页 / 当前页」。纯函数，不依赖 Astro，方便单测。
 */

export type Crumb = { name: string; path?: string };

export type BreadcrumbLabels = {
  home: string;
  allTags: string;
  sections: Record<string, string>;
  // 「日报归档」这类中间层级的名字，可选
  digest?: string;
};

const SECTION_ORDER = ["ai", "invest", "photo", "hike", "tag"] as const;

/** 把 pathname 拆成「去掉语言前缀与尾斜杠」的段 */
export function splitPath(pathname: string): string[] {
  const clean = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const segments = clean.split("/").filter(Boolean);
  if (segments[0] === "en") segments.shift();
  return segments;
}

/** 带语言前缀的站内路径，统一以 / 结尾 */
function href(path: string, lang: "zh" | "en"): string {
  const base = path === "/" ? "/" : path.endsWith("/") ? path : `${path}/`;
  return lang === "en" ? (base === "/" ? "/en/" : `/en${base}`) : base;
}

export function buildBreadcrumb(opts: {
  pathname: string;
  lang: "zh" | "en";
  title: string;
  labels: BreadcrumbLabels;
}): Crumb[] | null {
  const { pathname, lang, title, labels } = opts;
  const segments = splitPath(pathname);
  // 首页自己输出 WebSite schema，不需要面包屑
  if (segments.length === 0) return null;

  const trail: Crumb[] = [{ name: labels.home, path: href("/", lang) }];
  const section = segments[0] as (typeof SECTION_ORDER)[number];
  const isSection = (SECTION_ORDER as readonly string[]).includes(section);

  if (section === "tag") {
    // /tag/ 自己就是标签总览；/tag/x/ 上面多一级「全部标签」
    if (segments.length >= 2) {
      trail.push({ name: labels.allTags, path: href("/tag", lang) });
    }
    trail.push({ name: title });
    return trail;
  }

  if (isSection && segments.length >= 2) {
    const sectionLabel = labels.sections[section] ?? section;
    trail.push({ name: sectionLabel, path: href(`/${section}`, lang) });
    // 日报类文章在板块与文章之间插一级「日报归档」：/ai/digest-2026-06-25/
    // 注意 /invest/digest/ 自己就是归档索引，不该再插一级
    const second = segments[1] ?? "";
    const isDigestArticle =
      second.startsWith("digest-") || (second === "digest" && segments.length >= 3);
    if (isDigestArticle && labels.digest) {
      trail.push({ name: labels.digest, path: href(`/${section}/digest`, lang) });
    }
    trail.push({ name: title });
    return trail;
  }

  trail.push({ name: title });
  return trail;
}

/** 面包屑 → schema.org BreadcrumbList（末级不带 item，与 Google 的推荐一致） */
export function breadcrumbJsonLd(trail: Crumb[], sitePrefix: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      ...(crumb.path ? { item: `${sitePrefix}${crumb.path}` } : {}),
    })),
  };
}
