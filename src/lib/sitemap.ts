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
  "/photo",
  "/hike",
  "/explore",
  "/topics",
  "/tag",
  "/uses",
  "/now",
  "/changelog",
  "/guestbook",
  "/subscribe",
  "/privacy",
  "/terms",
  "/data",
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
  "/guestbook",
  "/subscribe",
  "/privacy",
  "/terms",
  "/data",
  "/contact",
] as const;

export function getStaticSitemapPaths(): string[] {
  return [
    ...ZH_STATIC_PATHS,
    ...EN_STATIC_PATHS.map((path) => path === "/" ? "/en/" : `/en${path}`),
  ];
}
