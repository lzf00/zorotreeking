export const languages = { zh: "中文", en: "English" } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = "zh";

export const ui = {
  zh: {
    "site.title": "ZoroTreeking",
    "site.tagline": "AI · 投资 · 摄影 · 徒步",
    "nav.home": "首页",
    "nav.ai": "AI 学习",
    "nav.invest": "个人投资",
    "nav.photo": "摄影",
    "nav.hike": "徒步",
    "nav.about": "关于",
    "nav.admin": "管理后台（写新文章）",
    "lang.switch": "English",
    "section.ai.title": "AI 学习",
    "section.ai.desc": "笔记、论文、工具、思考",
    "section.invest.title": "个人投资",
    "section.invest.desc": "持仓、复盘、数据公开",
    "section.photo.title": "摄影",
    "section.photo.desc": "镜头里的生活与远方",
    "section.hike.title": "徒步",
    "section.hike.desc": "路线、轨迹、风景",
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
    "site.tagline": "AI · Investment · Photography · Hiking",
    "nav.home": "Home",
    "nav.ai": "AI Learning",
    "nav.invest": "Investment",
    "nav.photo": "Photography",
    "nav.hike": "Hiking",
    "nav.about": "About",
    "nav.admin": "Admin (write a new post)",
    "lang.switch": "中文",
    "section.ai.title": "AI Learning",
    "section.ai.desc": "Notes, papers, tools, thoughts",
    "section.invest.title": "Investment",
    "section.invest.desc": "Holdings, reviews, fully transparent",
    "section.photo.title": "Photography",
    "section.photo.desc": "Life and far places through a lens",
    "section.hike.title": "Hiking",
    "section.hike.desc": "Routes, tracks, landscapes",
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

export function pathWithLang(path: string, lang: Lang): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return lang === defaultLang ? `/${clean}` : `/${lang}/${clean}`;
}
