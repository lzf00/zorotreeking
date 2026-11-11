import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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


/**
 * 静态页的 lastmod。三条来源，按优先级：
 *   1. 板块首页（/ai、/invest、/photo、/tag…）内容每天在变 —— 取该板块最新一篇的日期，
 *      比源码文件的提交时间准得多；
 *   2. 其它静态页（/about、/uses、/now、/privacy…）—— 取该页源码文件的最后一次提交日期；
 *   3. 拿不到 git（浅克隆、没装 git）就干脆不写 lastmod。写一个假日期会被搜索引擎判定
 *      "不可信"，然后整份 sitemap 的 lastmod 都被忽略，比不写更糟。
 */
const gitDateCache = new Map<string, Date | null>();

function lastCommitDate(file: string): Date | null {
  if (gitDateCache.has(file)) return gitDateCache.get(file)!;
  let result: Date | null = null;
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) result = new Date(`${out}T00:00:00+08:00`);
  } catch {
    // 静默：CI 没 checkout 历史时就是拿不到
  }
  gitDateCache.set(file, result);
  return result;
}

/** 把路由映射回源码文件：`/about` → src/pages/about.astro，`/en/tag` → src/pages/en/tag/index.astro */
function sourceFileFor(route: string): string | null {
  const candidates =
    route === "/"
      ? ["src/pages/index.astro"]
      : [`src/pages${route}.astro`, `src/pages${route}/index.astro`];
  return candidates.find((file) => existsSync(file)) ?? null;
}

const latestOf = (entries: { data: { date: Date; updated?: Date } }[]): Date | undefined =>
  entries.reduce<Date | undefined>((latest, entry) => {
    const date = entry.data.updated ?? entry.data.date;
    return !latest || date > latest ? date : latest;
  }, undefined);

const newer = (...dates: (Date | undefined | null)[]): Date | undefined => {
  let best: Date | undefined;
  for (const date of dates) {
    if (date && (!best || date > best)) best = date;
  }
  return best;
};

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

  // 板块首页跟着内容走，其余静态页跟着源码提交走
  const latestBySection: Record<string, Date | undefined> = {
    "/ai": latestOf(aiZh),
    "/en/ai": latestOf(aiEn),
    "/ai/digest": latestOf(aiZh.filter((e: any) => (e.data.tags ?? []).includes("digest"))),
    "/en/ai/digest": latestOf(aiEn.filter((e: any) => (e.data.tags ?? []).includes("digest"))),
    "/invest": latestOf(invZh),
    "/en/invest": latestOf(invEn),
    "/invest/digest": latestOf(invZh.filter((e: any) => (e.data.tags ?? []).includes("digest"))),
    "/en/invest/digest": latestOf(invEn.filter((e: any) => (e.data.tags ?? []).includes("digest"))),
    "/invest/market": latestOf(invZh.filter((e: any) => e.data.translationKey.startsWith("market-recap-"))),
    "/en/invest/market": latestOf(invEn.filter((e: any) => e.data.translationKey.startsWith("market-recap-"))),
    "/photo": latestOf(photoZh),
    "/en/photo": latestOf(photoEn),
    "/hike": latestOf(hikeZh),
    "/en/hike": latestOf(hikeEn),
    "/tag": latestOf([...aiZh, ...invZh, ...hikeZh, ...photoZh]),
    "/en/tag": latestOf([...aiEn, ...invEn, ...hikeEn, ...photoEn]),
  };
  const urls: { loc: string; lastmod?: Date }[] = getStaticSitemapPaths().map((path) => {
    const contentDate = latestBySection[path];
    const file = contentDate ? null : sourceFileFor(path);
    return {
      loc: withSlash(`${site}${path}`),
      lastmod: newer(contentDate, file ? lastCommitDate(file) : null),
    };
  });
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
    const latestByTag = new Map<string, Date>();
    for (const entry of entries) {
      const date = entry.data.updated ?? entry.data.date;
      for (const tag of entry.data.tags ?? []) {
        if (!tag) continue;
        const current = latestByTag.get(tag);
        if (!current || date > current) latestByTag.set(tag, date);
      }
    }
    for (const [tag, lastmod] of latestByTag) {
      urls.push({
        loc: withSlash(`${site}${lang === "en" ? "/en" : ""}/tag/${tagToSlug(tag)}`),
        lastmod,
      });
    }
  };
  pushTags("zh", zhEntries);
  pushTags("en", enEntries);

  // 个股页数据来自 wind-stock-details.json，它的 date 就是行情快照日，比源码提交时间准确
  const stockLastmod = stockDetails.date
    ? new Date(`${stockDetails.date}T00:00:00+08:00`)
    : lastCommitDate("src/data/wind-stock-details.json") ?? undefined;
  for (const code of Object.keys(stockDetails.stocks ?? {})) {
    urls.push({ loc: withSlash(`${site}/invest/stock/${encodeURIComponent(code)}`), lastmod: stockLastmod });
    urls.push({ loc: withSlash(`${site}/en/invest/stock/${encodeURIComponent(code)}`), lastmod: stockLastmod });
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
