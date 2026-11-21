const ZH_STATIC_PATHS = [
  "/",
  "/about",
  "/ai",
  "/ai/digest",
  "/invest",
  "/invest/digest",
  "/invest/etf",
  "/invest/market",
  "/invest/hk-market",
  "/invest/us-market",
  "/photo",
  "/hike",
  "/explore",
  "/topics",
  "/archive",
  "/tag",
  "/uses",
  "/now",
  "/changelog",
  "/guestbook",
  "/subscribe",
  "/privacy",
  "/terms",
  // "/data" 故意不在 sitemap 里：它是「我的数据」工具页，已 noindex（第 112 轮）
  "/contact",
] as const;

const EN_STATIC_PATHS = [
  "/",
  "/about",
  "/ai",
  "/ai/digest",
  "/invest",
  "/invest/digest",
  "/invest/market",
  "/invest/hk-market",
  "/photo",
  "/hike",
  "/tag",
  "/topics",
  "/archive",
  "/guestbook",
  "/subscribe",
  "/privacy",
  "/terms",
  // 同上：/en/data 也是 noindex 的个人数据工具页
  "/contact",
] as const;

export function getStaticSitemapPaths(): string[] {
  return [
    ...ZH_STATIC_PATHS,
    ...EN_STATIC_PATHS.map((path) => path === "/" ? "/en/" : `/en${path}`),
  ];
}
