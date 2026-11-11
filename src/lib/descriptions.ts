/**
 * 列表/索引类页面的 meta description。
 *
 * 这些页面的描述原来要么是 i18n 里的一句套话（"笔记、论文、工具、思考"，9 个字），
 * 要么是"带标签 #arxiv"这种模板串——搜索引擎基本当作没有，`npm run check:seo`
 * 把它们全算进"描述偏短"的 47 页里。
 *
 * 这里改成用**构建时就地算出来的事实**拼描述：篇数 + 最新一篇的标题与月份。
 * 好处是每页都不一样（不是 700 页共用一句），也不需要人工维护。
 */

export type Lang = "zh" | "en";

/** 只要标题和日期，避免把 astro content 的具体类型搬进来。 */
export interface PostLike {
  title: string;
  date: Date;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 按字符数截断，末尾留省略号；中文按字符、英文按字符都够用。 */
export function clip(text: string, max: number): string {
  const flat = collapse(text);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthYear(date: Date, lang: Lang): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return lang === "zh" ? `${year} 年 ${month} 月` : `${EN_MONTHS[month - 1]} ${year}`;
}

/** 标签页：`#arxiv 标签下共 42 篇文章，最新一篇《…》（2026 年 11 月）。` */
export function tagDescription(tag: string, posts: PostLike[], lang: Lang): string {
  const count = posts.length;
  const latest = posts.reduce<PostLike | undefined>(
    (best, p) => (!best || p.date.getTime() > best.date.getTime() ? p : best),
    undefined,
  );

  if (lang === "zh") {
    if (count === 0) return `#${tag} 标签下暂无文章。`;
    if (count === 1) return `#${tag} 标签下目前只有 1 篇文章：《${clip(latest!.title, 30)}》。`;
    const tail = latest ? `，最新一篇《${clip(latest.title, 26)}》（${monthYear(latest.date, lang)}）` : "";
    return `#${tag} 标签下共 ${count} 篇文章${tail}。`;
  }

  if (count === 0) return `Nothing tagged #${tag} yet.`;
  if (count === 1) return `One post tagged #${tag}: “${clip(latest!.title, 50)}”.`;
  const tail = latest ? `, most recently “${clip(latest.title, 50)}” (${monthYear(latest.date, lang)})` : "";
  return `${count} posts tagged #${tag}${tail}.`;
}

/** 标签总览：`全部 96 个标签，按热度索引 AI、投资、摄影与旅行内容。` */
export function tagIndexDescription(count: number, lang: Lang): string {
  if (lang === "zh") return `全部 ${count} 个标签，按热度索引 AI、投资、摄影与旅行的内容。`;
  return `All ${count} tags across AI notes, investing, photography and hiking.`;
}

export type SectionKind = "ai" | "invest" | "photo";

export interface SectionStats {
  /** 文章数（photo 用相册数） */
  count: number;
  /** photo 才是照片总数 */
  photos?: number;
  latest?: PostLike;
}

/** 板块首页：篇数 + 板块内容 + 最新一篇。 */
export function sectionDescription(kind: SectionKind, stats: SectionStats, lang: Lang): string {
  const { count, photos = 0, latest } = stats;
  const latestZh = latest ? `，最新《${clip(latest.title, 24)}》` : "";
  const latestEn = latest ? `, latest “${clip(latest.title, 46)}”` : "";

  if (lang === "zh") {
    switch (kind) {
      case "ai":
        return `AI 板块共 ${count} 篇笔记与论文精选（含每日 AI 日报、论文解读与工具实践）${latestZh}。`;
      case "invest":
        return `投资板块共 ${count} 篇复盘与公开数据（含每日市场复盘、持仓与 ETF 记录）${latestZh}。`;
      case "photo":
        return `摄影板块共 ${count} 个相册、${photos} 张照片，按城市与主题整理${latestZh}。`;
    }
  }

  switch (kind) {
    case "ai":
      return `${count} AI notes, paper picks and tool write-ups (including the daily AI digest)${latestEn}.`;
    case "invest":
      return `${count} investing posts with fully public data: daily market recaps, holdings and ETF tracking${latestEn}.`;
    case "photo":
      return `${count} photo albums, ${photos} photos in total, organised by place and subject${latestEn}.`;
  }
}
