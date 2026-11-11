/**
 * 内容标题归一化（rehype）。
 *
 * 背景：页面模板自己已经渲染了一个 `<h1>`（文章标题），但自动生成的正文
 * 也从 `#` 开始写标题：
 *   - 投资/AI 日报正文：`# 东方财富 7×24`（来源分组）、`## <a>…</a>`（单条快讯）
 *   - 每日市场复盘正文：`# 📊 11月10日股票日报` —— 和 frontmatter title 完全重复
 * 结果是一页有 2～10 个 `<h1>`（2026-11 SEO 巡查：718 个日报页 + 230 个复盘页），
 * 屏幕阅读器会把这些分组标题当页面主标题播报，搜索引擎也无法判断哪一个是 h1。
 *
 * 这里在渲染层修掉，不动正文——正文是每天自动生成的归档，保持原样更重要：
 *   1. 日报：整棵标题树降一级（h1→h2，h2→h3 …），视觉层级由模板 CSS 保住；
 *   2. 复盘：丢掉开头那个与页面标题重复的 h1（正文其它小节本来就从 h2 起）。
 */

/** 把树里所有标题降 `shift` 级，最深封顶 h6。 */
export function shiftHeadings(tree, shift = 1) {
  if (shift <= 0) return 0;
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "element" && /^h[1-6]$/.test(node.tagName)) {
      const next = Math.min(6, Number(node.tagName.slice(1)) + shift);
      node.tagName = `h${next}`;
      node.properties = { ...(node.properties ?? {}), level: undefined };
      delete node.properties.level;
      count += 1;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return count;
}

/** 取节点里所有文本（用于识别重复标题）。 */
export function textOf(node) {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

const normalize = (s) => s.replace(/\s+/g, " ").trim();

/**
 * 若正文第一个标题就是页面标题的复制，把它删掉。
 * 只删「第一个元素且是 h1」的那一个；正文中间的分组标题一律不动。
 * 传了 pageTitle 就顺带核对文字（不一致则不删），没传就按结构判断——
 * MDX 编译阶段拿不到 frontmatter 时用后者。
 */
export function dropDuplicateLeadingTitle(tree, pageTitle) {
  const root = tree?.children ?? [];
  const wanted = normalize(pageTitle ?? "");
  // 找到「第一个标题」——前面可能有引用块/说明段落（复盘正文就是这样），
  // 只要在它之前还没出现过任何标题，就认为它是页面标题的重复。
  for (let i = 0; i < root.length; i++) {
    const node = root[i];
    if (!node || node.type === "text" || node.type === "comment") continue;
    if (node.type !== "element") continue;
    if (!/^h[1-6]$/.test(node.tagName)) continue;
    if (node.tagName !== "h1") return false;
    if (wanted && normalize(textOf(node)) !== wanted) return false;
    root.splice(i, 1);
    while (root[i] && root[i].type === "text" && normalize(root[i].value ?? "") === "") root.splice(i, 1);
    return true;
  }
  return false;
}

/** 内容路径判定：用 stdout 里的绝对路径后缀匹配，避免依赖 vfile 细节。 */
export const DIGEST_PATH = /\/content\/[^/]+\/digest-[^/]+\.(?:zh|en)\.mdx$/;
export const RECAP_PATH = /\/content\/[^/]+\/market-recap-[^/]+\.(?:zh|en)\.mdx$/;

/**
 * Astro rehype 插件入口。
 * @param {{ digest?: RegExp, recap?: RegExp }} [options]
 */
export default function rehypeNormalizeContentHeadings(options = {}) {
  const digest = options.digest ?? DIGEST_PATH;
  const recap = options.recap ?? RECAP_PATH;
  return (tree, file) => {
    const filePath = file?.path ?? file?.history?.[0] ?? "";
    if (!filePath) return;
    if (digest.test(filePath)) {
      shiftHeadings(tree, 1);
      return;
    }
    if (recap.test(filePath)) {
      // MDX 编译阶段 vfile 上不一定有 frontmatter，所以这里按结构判定：
      // 复盘正文固定以「页面标题的重复」开头（230/230 验证过），是 h1 就删。
      const frontmatter = file?.data?.astro?.frontmatter;
      dropDuplicateLeadingTitle(tree, frontmatter?.title);
    }
  };
}
