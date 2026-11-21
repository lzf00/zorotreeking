/**
 * 日报的"摘要覆盖度"（第 120 轮）。
 *
 * 线上有 20 期中文日报（另有 18 期部分条目）**整条都没有摘要正文** —— 只有标题 + 来源 + 链接，
 * 但它们的 frontmatter 描述、以及 RSS/Atom 的 `<summary>`，都还在说「多源聚合 + AI 摘要」。
 * 读者从阅读器点进来，看到的是一串论文标题，没有任何摘要。
 *
 * 这里只做一件事：如实数一条日报里**有多少条目真的带了正文**，
 * 好让页面/feed 能说实话，而不是靠人记得哪一期坏了。
 */

export type DigestCoverage = {
  /** 二级标题数（条目数） */
  items: number;
  /** 带正文字段的条目数 */
  withSummary: number;
  /** 全部条目都没有正文 */
  allMissing: boolean;
  /** 有部分条目缺正文 */
  someMissing: boolean;
};

/**
 * 这些前缀说明这一行不是摘要正文，而是标题/meta/组件/图片。
 * `(` 也在其中：生成/翻译链路漏出来的道歉句都是「（LLM 摘要失败…）」这种括号说明，
 * 把它算成"有摘要"正是第 120 轮英文页没出提示的原因。
 */
const NOT_PROSE = ["*", "<", "!", ">", "-", "|", "```", "#", "(", "（"];

/**
 * 从 MDX 正文统计摘要覆盖度。
 * 条目边界是 `## `；一个条目的"正文"= 标题之后**第一个非空、非 meta、非组件**的普通段落。
 */
export function digestCoverage(body: string | null | undefined): DigestCoverage {
  const text = body ?? "";
  const sections = text.split(/^## /m).slice(1);
  let withSummary = 0;
  for (const section of sections) {
    const lines = section.split("\n").slice(1).map((line) => line.trim());
    const hasProse = lines.some(
      (line) => line.length > 0 && !NOT_PROSE.some((prefix) => line.startsWith(prefix)),
    );
    if (hasProse) withSummary += 1;
  }
  const items = sections.length;
  return {
    items,
    withSummary,
    allMissing: items > 0 && withSummary === 0,
    someMissing: items > 0 && withSummary > 0 && withSummary < items,
  };
}

/**
 * 给读者看的说明；不需要说明时返回 null（大多数日报是完整的，别给每页都加噪音）。
 */
export function coverageNotice(coverage: DigestCoverage, lang: "zh" | "en"): string | null {
  if (coverage.allMissing) {
    return lang === "zh"
      ? `本期 ${coverage.items} 条都没有生成摘要（自动摘要当时失败了），下面只列出标题、来源与原文链接。`
      : `No summaries were generated for these ${coverage.items} items (the automatic summariser failed at the time) — only titles, sources and links below.`;
  }
  if (coverage.someMissing) {
    const missing = coverage.items - coverage.withSummary;
    return lang === "zh"
      ? `本期 ${coverage.items} 条里有 ${missing} 条没有摘要，只列了标题与原文链接。`
      : `${missing} of the ${coverage.items} items below have no summary — title and original link only.`;
  }
  return null;
}
