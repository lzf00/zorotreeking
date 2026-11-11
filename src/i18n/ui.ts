const languages = { zh: "中文", en: "English" } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = "zh";

const ui = {
  zh: {
    "site.title": "ZoroTreeking",
    "site.tagline": "AI · 投资 · 摄影 · 徒步旅行",
    "nav.home": "首页",
    "nav.ai": "AI 学习",
    "nav.invest": "个人投资",
    "nav.photo": "摄影",
    "nav.hike": "徒步旅行",
    "nav.about": "关于",
    "nav.guestbook": "留言板",
    "nav.admin": "管理后台（写新文章）",
    // 屏幕上看得见的"主导航"这几个字要留给读屏器
    "nav.primary": "主导航",
    "nav.toc": "本页目录",
    "lang.switch": "English",
    "section.ai.title": "AI 学习",
    "section.ai.desc": "笔记、论文、工具、思考",
    "section.invest.title": "个人投资",
    "section.invest.desc": "持仓、复盘、数据公开",
    "section.photo.title": "摄影",
    "section.photo.desc": "镜头里的生活与远方",
    "section.hike.title": "徒步旅行",
    "section.hike.desc": "徒步路线、旅行攻略与沿途风景",
    "home.sections": "内容板块",
    "home.latest": "最近更新",
    "home.viewAll": "查看全部 →",
    "post.readTime": "分钟阅读",
    "post.draft": "草稿",
    "footer.builtWith": "由 Astro 构建",
    "tag.title": "标签",
    "tag.allTags": "全部标签",
    "tag.postsWith": "带标签",
    "tag.count": "篇",
    "tag.empty": "暂无文章",
  },
  en: {
    "site.title": "ZoroTreeking",
    "site.tagline": "AI · Investment · Photography · Hiking & Travel",
    "nav.home": "Home",
    "nav.ai": "AI Learning",
    "nav.invest": "Investment",
    "nav.photo": "Photography",
    "nav.hike": "Hiking & Travel",
    "nav.about": "About",
    "nav.guestbook": "Guestbook",
    "nav.admin": "Admin (write a new post)",
    "nav.primary": "Primary",
    "nav.toc": "On this page",
    "lang.switch": "中文",
    "section.ai.title": "AI Learning",
    "section.ai.desc": "Notes, papers, tools, thoughts",
    "section.invest.title": "Investment",
    "section.invest.desc": "Holdings, reviews, fully transparent",
    "section.photo.title": "Photography",
    "section.photo.desc": "Life and far places through a lens",
    "section.hike.title": "Hiking & Travel",
    "section.hike.desc": "Trail routes, travel guides and landscapes",
    "home.sections": "Sections",
    "home.latest": "Latest",
    "home.viewAll": "View all →",
    "post.readTime": "min read",
    "post.draft": "Draft",
    "footer.builtWith": "Built with Astro",
    "tag.title": "Tags",
    "tag.allTags": "All tags",
    "tag.postsWith": "Posts tagged",
    "tag.count": "posts",
    "tag.empty": "No posts yet",
  },
} as const;

export type UIKey = keyof (typeof ui)["zh"];

export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return ui[lang][key] ?? ui[defaultLang][key] ?? key;
  };
}

export function getLangFromUrl(url: URL): Lang {
  const [, seg] = url.pathname.split("/");
  return seg in languages ? (seg as Lang) : defaultLang;
}

/**
 * 站内页面一律带尾斜杠：站点是 `build.format: "directory"`，canonical 与 nginx 都是
 * `/about/` 形式，而 `/about` 会 301 一次。导航、页脚、卡片全都走这个函数，所以在这里
 * 统一补斜杠，一次改动消掉全站数万处多余的跳转。
 * 带扩展名的静态文件（`/rss.xml`、`/photos/x.jpg`）保持原样，不能加斜杠。
 */
/** 需要保持原样的静态文件后缀（页面路由不会以这些结尾）。 */
const ASSET_EXTENSIONS = new Set([
  "xml", "json", "txt", "html", "css", "js", "mjs", "map",
  "png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "ico",
  "pdf", "webmanifest", "mp4", "webm", "gpx", "zip",
]);

export function pathWithLang(path: string, lang: Lang): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  const joined = (lang === defaultLang ? `/${clean}` : `/${lang}/${clean}`).replace(/\/{2,}/g, "/");
  if (joined.endsWith("/")) return joined;
  // 只有真正的静态文件才不加斜杠。不能简单地「含点就不加」：
  // 个股页是 /invest/stock/688981.SH 这种形式，代码里本身就带点。
  const lastSegment = joined.slice(joined.lastIndexOf("/") + 1);
  const ext = lastSegment.includes(".") ? lastSegment.slice(lastSegment.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ASSET_EXTENSIONS.has(ext)) return joined;
  return `${joined}/`;
}

const TRANSLATED_STATIC_PATHS = new Set([
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
]);

/**
 * Returns whether this route has a real counterpart in the other language.
 * Chinese-only utilities should not send visitors to a generated 404 page.
 */
export function hasAlternateLanguagePath(pathname: string): boolean {
  const normalized = pathname
    .replace(/^\/(zh|en)(\/|$)/, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";

  if (TRANSLATED_STATIC_PATHS.has(normalized)) return true;
  if (/^\/(ai|photo|hike|tag)\/[^/]+$/.test(normalized)) return true;
  if (/^\/invest\/stock\/[^/]+$/.test(normalized)) return true;
  if (
    /^\/invest\/[^/]+$/.test(normalized) &&
    normalized !== "/invest/etf" &&
    normalized !== "/invest/us-market"
  ) {
    return true;
  }
  return false;
}
