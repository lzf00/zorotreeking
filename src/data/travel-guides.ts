export type TravelGuide = {
  lang: "zh" | "en";
  slug: string;
  href: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  location: string;
  days: number;
  distanceKm: number;
  travelMode: string;
  season: string;
  route: string[];
};

/**
 * 旅行攻略索引。
 *
 * 新攻略只需把独立页面放进 public/hike/travel/<slug>/index.html，
 * 再在这里登记元数据，即可进入徒步旅行板块、首页和 sitemap。
 */
export const travelGuides: TravelGuide[] = [
  {
    lang: "zh",
    slug: "ali-grand-loop-2026",
    href: "/hike/travel/ali-grand-loop-2026/",
    title: "向西 · 阿里大环线 2026",
    description: "上海出发，13 天穿越珠峰、冈底斯、札达土林与羌塘边缘的高原自驾路书。",
    date: "2026-08-04",
    updated: "2026-08-04",
    location: "西藏 · 阿里大环线",
    days: 13,
    distanceKm: 4000,
    travelMode: "拉萨落地四驱",
    season: "2026 国庆",
    route: ["拉萨", "珠峰", "萨嘎", "塔钦", "札达", "狮泉河", "改则", "尼玛", "班戈", "拉萨"],
  },
];

export function getTravelGuides(lang: "zh" | "en") {
  return travelGuides
    .filter((guide) => guide.lang === lang)
    .sort((a, b) => b.date.localeCompare(a.date));
}
