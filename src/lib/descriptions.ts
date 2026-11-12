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

/** 只用来判断「英文描述里混进了中文」，不做别的转换。 */
const CJK = /[\u4e00-\u9fff]/;

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
    if (count === 1)
      return `#${tag} 标签下目前只有 1 篇文章：《${clip(latest!.title, 30)}》。这是同主题内容的归集页，之后带这个标签的文章会自动出现在这里。`;
    const tail = latest ? `，最新一篇《${clip(latest.title, 26)}》（${monthYear(latest.date, lang)}）` : "";
    return `#${tag} 标签下共 ${count} 篇文章${tail}。`;
  }

  if (count === 0) return `Nothing tagged #${tag} yet.`;
  if (count === 1)
    return `One post tagged #${tag}: “${clip(latest!.title, 50)}”. This page collects everything on that theme — new posts with the tag appear here automatically.`;
  const tail = latest ? `, most recently “${clip(latest.title, 50)}” (${monthYear(latest.date, lang)})` : "";
  return `${count} posts tagged #${tag}${tail}.`;
}

/** 标签总览：`全部 96 个标签，按热度索引 AI、投资、摄影与旅行内容。` */
export function tagIndexDescription(count: number, lang: Lang): string {
  if (lang === "zh")
    return `全部 ${count} 个标签，按热度索引 AI、投资、摄影与旅行的全部内容：选一个标签，就能顺着同一条线索把相关文章读完。`;
  return `All ${count} tags across AI notes, investing, photography and hiking — pick one and follow that single thread all the way through.`;
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
        return `摄影板块共 ${count} 个相册、${photos} 张照片，按城市与主题整理${latestZh}。点开相册可以逐张翻看，也能直接用 RSS 订阅新照片。`;
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

/** 把 digest/mdx 里的一行标题（常含内联 HTML `<a>`）还原成纯文本。 */
export function plainHeading(line: string): string {
  return collapse(
    line
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      // markdown 强调/链接的残留符号（标题里偶有 ** 或 *）
      .replace(/\*\*/g, "")
      .replace(/^\*|\*$/g, ""),
  );
}

/**
 * 日报页的描述：用正文里真实的条目标题拼，而不是「15 条快讯 · 多源聚合 + AI 改写」。
 *
 * 724 个日报页原来只有 121 种描述，最常见的一条重复了 129 次——搜索引擎看到的是
 * 一堆几乎相同的页面。标题来自当天抓到的新闻，天然一页一种。
 */
export function digestDescription(
  markdown: string,
  lang: Lang,
  kind: "ai" | "invest",
  date?: Date,
): string | undefined {
  const headings = markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => plainHeading(line.slice(3)))
    .filter((text) => text.length > 0);

  if (headings.length === 0) return undefined;

  const count = headings.length;
  const [first, second] = headings;
  const unit = kind === "ai" ? "篇论文" : "条快讯";
  const unitEn = kind === "ai" ? "paper picks" : "news briefs";

  // 连续两天的日报偶尔会抓到同样的前两条（同一批博客还没更新），
  // 末尾补日期让每页描述唯一，顺带让片段带上时间感
  const stamp = date
    ? lang === "zh"
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
      : `${EN_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
    : null;

  const end = (body: string, mark: string) => {
    const withMark = body.endsWith("…") ? body : body + mark;
    if (!stamp) return withMark;
    return lang === "zh" ? `${withMark}（${stamp}）` : `${withMark} (${stamp})`;
  };

  if (lang === "zh") {
    const tail = second ? `；${clip(second, 30)}` : "";
    return end(`${count} ${unit}：${clip(first, 34)}${tail}`, "。");
  }

  const tail = second ? `; ${clip(second, 50)}` : "";
  const en = end(`${count} ${unitEn}: ${clip(first, 60)}${tail}`, ".");
  // 个别英文稿的条目锚文本没被翻译（477 页里有 9 页），中英混排的描述不如回退 frontmatter
  return CJK.test(en) ? undefined : en;
}

/**
 * 周报页（/ai/weekly-YYYY-Www）的描述。
 *
 * 原来 19 个中文周报共用一句「AI 7 · 投资 12 · 徒步 0 · 站长本周观察」，
 * 英文 14 个也是同一句——和日报描述一个毛病。这里改成从正文里数出一周各栏目的
 * 条目数，再带上前两条标题，让每周的片段都不同。
 */
export function weeklyDescription(markdown: string, lang: Lang): string | undefined {
  const lines = markdown.split("\n");
  const sections: { name: string; items: string[] }[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      sections.push({ name: plainHeading(line.slice(3)), items: [] });
      continue;
    }
    const item = line.match(/^-\s*\[([^\]]+)\]/);
    if (item && sections.length) sections[sections.length - 1].items.push(plainHeading(item[1]));
  }

  const filled = sections.filter((s) => s.items.length > 0);
  if (filled.length === 0) return undefined;

  const total = filled.reduce((n, s) => n + s.items.length, 0);
  const counts = filled.map((s) => `${s.name} ${s.items.length}`);

  if (lang === "zh") {
    const first = filled[0].items[0];
    const body = `本周共 ${total} 篇：${counts.join("、")}；含《${clip(first, 26)}》等。`;
    return body.length > 20 ? body : undefined;
  }

  const first = filled[0].items[0];
  const body = `${total} posts this week — ${filled.map((s) => `${s.name} ${s.items.length}`).join(", ")} — including “${clip(first, 46)}”.`;
  return CJK.test(body) ? undefined : body;
}

/**
 * 市场复盘页的描述：给指数涨跌前面加日期。
 *
 * 指数涨跌偶尔会连着几天一模一样（2026-10-01/02/05 都是「上证 +0.31% · 深成
 * -0.11% · 创业板 -0.23%」），描述因此变成重复。日期是这几页唯一稳定的差异，
 * 而且对搜索结果来说也更有用：读者能立刻看出是哪天的收盘。
 */
export function recapDescription(description: string | undefined, date: Date, lang: Lang): string | undefined {
  if (!description) return undefined;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const stamp = lang === "zh" ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : EN_MONTHS[month - 1] + ` ${day}, ${year}`;
  if (description.includes(stamp) || description.includes(`${month}月${day}日`)) return description;
  return lang === "zh" ? `${stamp} 收盘：${description}` : `Close on ${stamp}: ${description}`;
}
