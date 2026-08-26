export type TravelGuide = {
  lang: "zh" | "en";
  slug: string;
  href: string;
  title: string;
  description: string;
  date: string;
  updated: string;
  location: string;
  days: number;
  distanceKm: number;
  travelMode: string;
  season: string;
  route: string[];
  destination: "lhasa" | "lanzhou" | "chengdu";
  destinationLabel: "拉萨" | "兰州" | "成都";
  scope: "complete" | "segment";
  scopeLabel: "完整行程" | "返程接驳段";
  status: "planning";
};

export type TravelGuideFilters = {
  destination?: TravelGuide["destination"];
  scope?: TravelGuide["scope"];
};

/**
 * 旅行攻略索引。
 *
 * 新攻略可以使用 Astro 独立页面或 public/hike/travel/<slug>/index.html，
 * 再在这里登记元数据，即可进入徒步旅行板块、首页和 sitemap。
 */
export const travelGuides: TravelGuide[] = [
  {
    lang: "zh",
    slug: "ali-grand-loop-lhasa-return-2026",
    href: "/hike/travel/ali-grand-loop-lhasa-return-2026/",
    title: "闭环 · 阿里大环线拉萨取还 2026",
    description: "9 月 26 日拉萨取车，9 月 29 日住珠峰景区看日落星空，10 月 2 日到狮泉河，G317 经洞措、色林措、班戈、纳木措快返，10 月 5 日回拉萨住宿。",
    date: "2026-08-09",
    updated: "2026-08-26",
    location: "西藏 · 阿里大环线",
    days: 12,
    distanceKm: 4000,
    travelMode: "拉萨取车 · 拉萨还车",
    season: "2026 国庆",
    route: ["拉萨", "日喀则", "定日", "珠峰", "萨嘎", "塔钦", "札达", "狮泉河", "改则", "尼玛", "班戈", "当雄", "拉萨", "上海"],
    destination: "lhasa",
    destinationLabel: "拉萨",
    scope: "complete",
    scopeLabel: "完整行程",
    status: "planning",
  },
  {
    lang: "zh",
    slug: "ali-central-loop-nagqu-g317-chengdu-2026",
    href: "/hike/travel/ali-central-loop-nagqu-g317-chengdu-2026/",
    title: "北进 · 那曲沿 G317 自驾成都 2026",
    description: "那曲沿 G317 经昌都、德格和甘孜，在炉霍转 G350 抄近成都；只有 10 月 4 日清晨离开那曲，才可能 7 日抵沪。",
    date: "2026-08-09",
    updated: "2026-08-09",
    location: "西藏 · 四川",
    days: 4,
    distanceKm: 1870,
    travelMode: "G317 / G350 · 成都还车",
    season: "2026 国庆",
    route: ["那曲", "索县", "巴青", "丁青", "昌都", "江达", "德格", "甘孜", "炉霍", "道孚", "丹巴", "汶川", "成都", "上海"],
    destination: "chengdu",
    destinationLabel: "成都",
    scope: "segment",
    scopeLabel: "返程接驳段",
    status: "planning",
  },
  {
    lang: "zh",
    slug: "ali-central-loop-nagqu-chengdu-2026",
    href: "/hike/travel/ali-central-loop-nagqu-chengdu-2026/",
    title: "穿湖 · 阿里中线至成都 2026",
    description: "狮泉河掉头经霍尔、亚热、仁多、措勤、文布南村到尼玛；抵达那曲后返回拉萨还车、转场成都，并在 10 月 7 日抵达上海。",
    date: "2026-08-09",
    updated: "2026-08-09",
    location: "西藏 · 四川",
    days: 12,
    distanceKm: 4300,
    travelMode: "拉萨取还 · 成都转场",
    season: "2026 国庆",
    route: ["拉萨", "日喀则", "萨嘎", "塔钦", "札达", "狮泉河", "霍尔", "亚热", "仁多", "措勤", "文布南村", "尼玛", "那曲", "拉萨", "成都", "上海"],
    destination: "chengdu",
    destinationLabel: "成都",
    scope: "complete",
    scopeLabel: "完整行程",
    status: "planning",
  },
  {
    lang: "zh",
    slug: "ali-central-loop-lhasa-lanzhou-2026",
    href: "/hike/travel/ali-central-loop-lhasa-lanzhou-2026/",
    title: "穿湖 · 阿里中线至兰州 2026",
    description: "狮泉河掉头经霍尔、亚热、仁多、措勤与文布南村到尼玛，再由那曲、格尔木、西宁到兰州还车，10 月 7 日返沪。",
    date: "2026-08-09",
    updated: "2026-08-09",
    location: "西藏 · 青海 · 甘肃",
    days: 12,
    distanceKm: 5650,
    travelMode: "拉萨取车 · 兰州还车",
    season: "2026 国庆",
    route: ["拉萨", "日喀则", "萨嘎", "塔钦", "札达", "狮泉河", "霍尔", "亚热", "仁多", "措勤", "文布南村", "尼玛", "那曲", "格尔木", "西宁", "兰州", "上海"],
    destination: "lanzhou",
    destinationLabel: "兰州",
    scope: "complete",
    scopeLabel: "完整行程",
    status: "planning",
  },
  {
    lang: "zh",
    slug: "ali-grand-loop-lhasa-lanzhou-2026",
    href: "/hike/travel/ali-grand-loop-lhasa-lanzhou-2026/",
    title: "向东 · 阿里大环线至兰州 2026",
    description: "9 月 26 日拉萨取车，穿越阿里南北线后经那曲、格尔木、西宁至兰州异地还车，高铁返回上海。",
    date: "2026-08-09",
    updated: "2026-08-09",
    location: "西藏 · 青海 · 甘肃",
    days: 12,
    distanceKm: 5300,
    travelMode: "拉萨取车 · 兰州还车",
    season: "2026 国庆",
    route: ["拉萨", "日喀则", "萨嘎", "塔钦", "札达", "狮泉河", "改则", "尼玛", "那曲", "格尔木", "西宁", "兰州", "上海"],
    destination: "lanzhou",
    destinationLabel: "兰州",
    scope: "complete",
    scopeLabel: "完整行程",
    status: "planning",
  },
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
    destination: "lhasa",
    destinationLabel: "拉萨",
    scope: "complete",
    scopeLabel: "完整行程",
    status: "planning",
  },
];

export function getTravelGuides(lang: "zh" | "en", filters: TravelGuideFilters = {}) {
  return travelGuides
    .filter((guide) => guide.lang === lang)
    .filter((guide) => !filters.destination || guide.destination === filters.destination)
    .filter((guide) => !filters.scope || guide.scope === filters.scope)
    .sort((a, b) => b.date.localeCompare(a.date));
}
