/**
 * 从 digest mdx 的 raw body 里提取前 N 条 entry 标题，作为"本期看点"展示在列表页。
 * 匹配模板：`## <a ...>1. Title</a>` 或 `## 1. Title`（fallback）
 */
export function extractDigestHighlights(body: string, n: number = 3): string[] {
  const titles: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("## ")) continue;
    const stripped = line
      .replace(/^## /, "")
      .replace(/<a[^>]*>/gi, "")
      .replace(/<\/a>/gi, "")
      .trim();
    const m = stripped.match(/^\d+\.\s*(.+?)\s*$/);
    if (m) {
      titles.push(m[1]);
      if (titles.length >= n) break;
    }
  }
  return titles;
}
