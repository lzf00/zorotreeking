import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";
import stockDetails from "@/data/wind-stock-details.json";
import { loadPhotoManifest, resolveAlbumKey } from "@/lib/photo-manifests";
import { travelGuides } from "@/data/travel-guides";
import { getStaticSitemapPaths } from "@/lib/sitemap";
import { tagToSlug } from "@/lib/tags";
import { buildChangelog, readGitLog } from "@/lib/changelog";
import { DIGEST_PAGE_SIZE, digestPagePaths } from "@/lib/digest-pagination";
import { ARCHIVE_PAGE_SIZE } from "@/lib/archive-pagination";
import { pagePaths } from "@/lib/pagination";
import { TAG_PAGE_SIZE } from "@/lib/tag-pagination";
import { CHANGELOG_PAGE_SIZE } from "@/lib/changelog-pagination";
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
  type SitemapImage = { loc: string; title?: string; caption?: string };
  const urls: { loc: string; lastmod?: Date; images?: SitemapImage[] }[] = getStaticSitemapPaths().map((path) => {
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
  /**
   * 日报归档的第 2..N 页（第 189 轮）。
   *
   * 这些页是**可索引**的（分页导航带 rel=prev/next），所以必须进 sitemap ——
   * `check:seo` 有一条「可索引但不在 sitemap」的硬规则，漏了直接判红。
   * lastmod 取该页最新一期（新日报进来会把条目往后挤，页内容确实会变）。
   */
  const pushDigestPages = (base: string, entries: any[]) => {
    const digests = entries
      .filter((e) => (e.data.tags ?? []).includes("digest") || e.data.translationKey.startsWith("digest-"))
      .sort((a, b) => (b.data.date as Date).getTime() - (a.data.date as Date).getTime());
    for (const path of digestPagePaths(base, digests.length, DIGEST_PAGE_SIZE)) {
      const pageNo = Number(path.slice(path.lastIndexOf("/") + 1));
      const newestOnPage = digests[(pageNo - 1) * DIGEST_PAGE_SIZE];
      urls.push({
        loc: withSlash(`${site}${path}`),
        lastmod: newestOnPage?.data.updated ?? newestOnPage?.data.date,
      });
    }
  };
  /**
   * 归档页的第 2..N 页（第 190 轮）。理由同上：可索引就得分页进 sitemap。
   * lastmod 取该页最新一篇（新文章进来会把条目往后挤，页内容确实会变）。
   */
  const pushArchivePages = (base: string, entries: any[]) => {
    const posts = entries.slice().sort((a, b) => (b.data.date as Date).getTime() - (a.data.date as Date).getTime());
    for (const path of pagePaths(base, posts.length, ARCHIVE_PAGE_SIZE)) {
      const pageNo = Number(path.slice(path.lastIndexOf("/") + 1));
      const newestOnPage = posts[(pageNo - 1) * ARCHIVE_PAGE_SIZE];
      urls.push({
        loc: withSlash(`${site}${path}`),
        lastmod: newestOnPage?.data.updated ?? newestOnPage?.data.date,
      });
    }
  };
  /**
   * 更新日志的第 2..N 页（第 192 轮）。这一页随 git 历史增长，页数也一直涨，
   * 所以页数必须和页面用同一个 `CHANGELOG_PAGE_SIZE` 现算 —— 不能写死。
   */
  const changelogVisible = buildChangelog(readGitLog()).visibleCount;
  for (const path of pagePaths("/changelog", changelogVisible, CHANGELOG_PAGE_SIZE)) {
    urls.push({ loc: withSlash(`${site}${path}`), lastmod: lastCommitDate("src/pages/changelog/[...page].astro") ?? undefined });
  }

  pushArchivePages("/archive", [...aiZh, ...invZh, ...photoZh, ...hikeZh]);
  pushArchivePages("/en/archive", [...aiEn, ...invEn, ...photoEn, ...hikeEn]);

  pushDigestPages("/ai/digest", aiZh);
  pushDigestPages("/en/ai/digest", aiEn);
  pushDigestPages("/invest/digest", invZh);
  pushDigestPages("/en/invest/digest", invEn);
  /**
   * 相册页额外输出 image sitemap 扩展（第 58 轮）。
   *
   * 相册是本站最值得进图片搜索的内容，但图片只能靠爬虫顺着 <img> 发现；
   * `image:image` 让 Google 直接拿到图片地址 + 标题，不依赖渲染。
   * 每册最多 20 张：sitemap 上限 50k URL / 50 MB，而这条扩展是纯增量，
   * 全站 6 个相册页 ×20 = 120 条，体积可以忽略。
   */
  const IMAGES_PER_ALBUM = 20;
  const pushAlbum = (lang: "zh" | "en", entries: any[]) => {
    for (const e of entries) {
      const photos = loadPhotoManifest(resolveAlbumKey(e.data));
      const images: SitemapImage[] = photos.slice(0, IMAGES_PER_ALBUM).map((photo) => ({
        loc: new URL(photo.srcWebp ?? photo.src, site).toString(),
        title: photo.alt || e.data.title,
        caption: e.data.title,
      }));
      urls.push({
        loc: withSlash(`${site}${lang === "en" ? "/en" : ""}/photo/${e.data.translationKey}`),
        lastmod: e.data.updated ?? e.data.date,
        ...(images.length ? { images } : {}),
      });
    }
  };
  pushAlbum("zh", photoZh); pushAlbum("en", photoEn);
  for (const guide of travelGuides) {
    urls.push({ loc: withSlash(`${site}${guide.href}`), lastmod: new Date(`${guide.updated ?? guide.date}T00:00:00+08:00`) });
  }

  const zhEntries = [...aiZh, ...invZh, ...hikeZh, ...photoZh];
  const enEntries = [...aiEn, ...invEn, ...hikeEn, ...photoEn];
  const pushTags = (lang: "zh" | "en", entries: typeof zhEntries) => {
    const latestByTag = new Map<string, Date>();
    const countByTag = new Map<string, number>();
    for (const entry of entries) {
      const date = entry.data.updated ?? entry.data.date;
      for (const tag of entry.data.tags ?? []) {
        if (!tag) continue;
        const current = latestByTag.get(tag);
        if (!current || date > current) latestByTag.set(tag, date);
        countByTag.set(tag, (countByTag.get(tag) ?? 0) + 1);
      }
    }
    for (const [tag, lastmod] of latestByTag) {
      const base = `${lang === "en" ? "/en" : ""}/tag/${tagToSlug(tag)}`;
      urls.push({ loc: withSlash(`${site}${base}`), lastmod });
      // 第 191 轮：重标签页分页后，第 2..N 页是可索引页，必须一起进 sitemap
      for (const path of pagePaths(base, countByTag.get(tag) ?? 0, TAG_PAGE_SIZE)) {
        urls.push({ loc: withSlash(`${site}${path}`), lastmod });
      }
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
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    urls
      .map((u) => {
        const images = (u.images ?? [])
          .map(
            (img) =>
              `<image:image><image:loc>${escapeXml(img.loc)}</image:loc>` +
              (img.title ? `<image:title>${escapeXml(img.title)}</image:title>` : "") +
              (img.caption ? `<image:caption>${escapeXml(img.caption)}</image:caption>` : "") +
              `</image:image>`,
          )
          .join("");
        return `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}${images}</url>`;
      })
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
