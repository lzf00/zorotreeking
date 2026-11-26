/**
 * 搜索结果的「这是哪一类东西」（第 214 轮）。
 *
 * 站内 1292 页里有 1068 页是每日自动产出。搜一个热门词（"英伟达" 83 条）时，
 * 结果列表里全是标题相近的「AI 每日精选 · 2026-11-12」「投资复盘 · 2026-11-20」，
 * 读者很难一眼分清哪条是哪类、哪天的。
 *
 * 这里只从 URL 推出「板块 + 类型 + 日期」，不改索引、不改排序 ——
 * 索引层面的改动会污染命中片段（第 212 轮的教训），而这一层是纯展示。
 */

export type ResultKind = "digest" | "recap" | "weekly" | "post" | "page";

export type ResultMeta = {
  kind: ResultKind;
  /** ai | invest | photo | hike | site */
  section: "ai" | "invest" | "photo" | "hike" | "site";
  /** YYYY-MM-DD 或 null */
  date: string | null;
  /** 一行标签，例如「AI 日报 · 2026-11-12」 */
  label: string;
};

const SECTIONS = ["ai", "invest", "photo", "hike"] as const;

const LABELS = {
  zh: {
    ai: { digest: "AI 日报", weekly: "AI 周报", post: "AI 笔记" },
    invest: { digest: "投资日报", recap: "投资复盘", post: "投资笔记" },
    photo: { post: "摄影" },
    hike: { post: "徒步" },
    site: { page: "站点页面" },
  },
  en: {
    ai: { digest: "AI digest", weekly: "AI weekly", post: "AI note" },
    invest: { digest: "Invest digest", recap: "Invest recap", post: "Invest note" },
    photo: { post: "Photography" },
    hike: { post: "Hiking" },
    site: { page: "Site page" },
  },
} as const;

/** `/en/ai/digest-2026-11-25/` → `{ lang: "en", rest: "ai/digest-2026-11-25/" }` */
function splitLang(pathname: string): { lang: "zh" | "en"; rest: string } {
  if (pathname === "/en" || pathname === "/en/") return { lang: "en", rest: "" };
  if (pathname.startsWith("/en/")) return { lang: "en", rest: pathname.slice(4) };
  return { lang: "zh", rest: pathname.replace(/^\//, "") };
}

const DATE = /(\d{4}-\d{2}-\d{2})/;

export function describeResult(pathname: string): ResultMeta {
  const { lang, rest } = splitLang(pathname);
  const clean = rest.replace(/^\/+|\/+$/g, "");
  const parts = clean ? clean.split("/") : [];
  const section = (SECTIONS as readonly string[]).includes(parts[0]) ? (parts[0] as ResultMeta["section"]) : "site";
  const slug = parts[1] ?? "";
  const dict = LABELS[lang];

  let kind: ResultKind = "page";
  if (section !== "site") {
    kind = "post";
    if (/^digest-\d{4}-\d{2}-\d{2}$/.test(slug)) kind = "digest";
    else if (slug === "digest") kind = "digest";
    else if (/^market-recap-\d{4}-\d{2}-\d{2}$/.test(slug)) kind = "recap";
    else if (/^weekly-\d{4}-W\d{2}$/.test(slug)) kind = "weekly";
  }

  const date = DATE.exec(slug)?.[1] ?? null;
  const table = dict[section] as Record<string, string> | undefined;
  const base = table?.[kind] ?? (lang === "en" ? "Site page" : "站点页面");
  const label = date ? `${base} · ${date}` : base;
  return { kind, section, date, label };
}
