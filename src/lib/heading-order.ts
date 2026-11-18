/**
 * 标题层级检查（对应 Lighthouse 的 `heading-order` 审计）。
 *
 * 规则只有一条：**标题层级不能跳级**。从上一级可以往下降到任意深度，
 * 但往上只能一级一级加——`h1 → h3` 是问题，`h1 → h2 → h4` 也是问题，
 * `h1 → h2 → h3 → h2` 没问题。
 *
 * 为什么放在构建期查：Lighthouse 只审 12 个 URL，而这类问题往往藏在
 * 模板的角落（比如图表卡片的标签用了 h3、而页面没有 h2 承接）。
 * 全站扫一遍只要几百毫秒。
 */

export type Heading = { level: number; text: string };

export type HeadingIssue = {
  /** 上一级标题的级别（第一个标题时为 0） */
  from: number;
  /** 当前标题的级别 */
  to: number;
  text: string;
  kind: "skip" | "first-not-h1";
};

/** 从 HTML 里按文档顺序抽取标题，跳过脚本/样式/代码/模板里的假标题 */
export function extractHeadings(html: string): Heading[] {
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<template\b[\s\S]*?<\/template>/gi, "")
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, "")
    .replace(/<code\b[\s\S]*?<\/code>/gi, "");

  const headings: Heading[] = [];
  for (const m of cleaned.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    headings.push({
      level: Number(m[1]),
      text: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    });
  }
  return headings;
}

/**
 * 返回跳级/首个标题不是 h1 的问题。空页面（没有标题）不算问题——
 * 那是「缺 h1」，由 check-seo 的 h1 规则单独管。
 */
export function headingIssues(headings: Heading[]): HeadingIssue[] {
  const issues: HeadingIssue[] = [];
  let prev = 0;
  for (const heading of headings) {
    if (prev === 0) {
      // 第一级：从 1 开始最合理；从 2/3 开始说明上面的层级缺失
      if (heading.level !== 1) {
        issues.push({ from: 0, to: heading.level, text: heading.text, kind: "first-not-h1" });
      }
    } else if (heading.level > prev + 1) {
      issues.push({ from: prev, to: heading.level, text: heading.text, kind: "skip" });
    }
    prev = heading.level;
  }
  return issues;
}

/** 一句话描述问题，日志里直接能读 */
export function describeHeadingIssue(issue: HeadingIssue): string {
  if (issue.kind === "first-not-h1") return `首个标题是 h${issue.to}（应为 h1）：${issue.text.slice(0, 40)}`;
  return `h${issue.from} → h${issue.to} 跳级：${issue.text.slice(0, 40)}`;
}
