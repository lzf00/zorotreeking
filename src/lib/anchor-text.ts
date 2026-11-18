/**
 * 锚文本质量检查（构建期）。
 *
 * 为什么需要：站内有 6 万个站内链接，链接文本既是给用户看的导航线索，也是搜索引擎
 * 判断目标页主题的依据。图标按钮如果既没有可见文字、也没有 aria-label，就是「空锚
 * 文本」——对读屏软件是纯噪音，对 SEO 是浪费一次内链投票。这类缺陷靠人眼在 1175 个
 * 页面里翻是翻不出来的，所以在 `scripts/check-seo.mjs` 里做成硬门禁。
 *
 * 判定规则：
 * - `empty`（错误）：可见文字为空，且没有 aria-label / title 兜底 → 必定修复；
 * - `generic`（告警）：文字是「阅读更多 / Read more / 点击这里」这类无信息量短语。
 */

export type AnchorInfo = {
  href: string;
  /** 去掉标签、折叠空白后的可见文字 */
  text: string;
  ariaLabel: string;
  title: string;
};

export type AnchorIssue = {
  kind: "empty" | "generic";
  href: string;
  text: string;
};

/** 无信息量的通用锚文本（大小写不敏感，前后空白已去掉） */
const GENERIC_TEXTS = new Set([
  "阅读更多",
  "阅读全文",
  "查看更多",
  "查看详情",
  "了解更多",
  "更多",
  "详情",
  "点击这里",
  "点击",
  "这里",
  "链接",
  "read more",
  "read the full article",
  "learn more",
  "see more",
  "more",
  "more info",
  "view more",
  "view details",
  "details",
  "click here",
  "click",
  "here",
  "link",
]);

const SKIP_TAGS = /<(script|style|template|pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function attr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : "";
}

/** 提取页面里所有 `<a href>` 的可见文字与可访问名兜底 */
export function extractAnchors(html: string): AnchorInfo[] {
  const cleaned = html.replace(SKIP_TAGS, " ");
  const out: AnchorInfo[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const href = attr(attrs, "href");
    if (!href) continue;
    const text = decodeEntities(inner.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    out.push({ href, text, ariaLabel: attr(attrs, "aria-label").trim(), title: attr(attrs, "title").trim() });
  }
  return out;
}

/** 只挑站内链接：相对路径或本站域名的绝对路径 */
export function isInternalHref(href: string, site = "https://www.zorotreeking.online"): boolean {
  if (href.startsWith("/")) return !href.startsWith("//");
  return href.startsWith(site);
}

export function anchorIssues(anchors: readonly AnchorInfo[], site?: string): AnchorIssue[] {
  const issues: AnchorIssue[] = [];
  for (const a of anchors) {
    if (!isInternalHref(a.href, site)) continue;
    const accessibleName = a.text || a.ariaLabel || a.title;
    if (!accessibleName) {
      issues.push({ kind: "empty", href: a.href, text: "" });
      continue;
    }
    if (a.text && GENERIC_TEXTS.has(a.text.toLowerCase())) {
      issues.push({ kind: "generic", href: a.href, text: a.text });
    }
  }
  return issues;
}

export function describeAnchorIssue(issue: AnchorIssue): string {
  return issue.kind === "empty"
    ? `空锚文本（无可见文字也无 aria-label）：${issue.href}`
    : `通用锚文本「${issue.text}」：${issue.href}`;
}
