/**
 * 从 digest mdx 提取 TL;DR 浓缩区的 3 句话和 emoji 标签。
 * 兼容 backfill-digest-meta.ts / digest-fetch.ts 写入的 JSX 块。
 *
 * 返回：{ summary: string[3], tags: string[5] } 或 null（没有 TL;DR）
 */
export function extractTLDR(body: string): { summary: string[]; tags: string[] } | null {
  const blockMatch = body.match(/<div[^>]*>[\s\S]*?TL;DR[\s\S]*?<\/div>\s*<\/div>|<div[^>]*TL;DR[\s\S]*?<\/div>/);
  if (!blockMatch) return null;
  const block = blockMatch[0];
  const summary: string[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(block))) {
    const text = m[1]
      .replace(/\\([{}])/g, "$1")
      .replace(/&lt;/g, "<")
      .trim();
    if (text) summary.push(text);
  }
  const tags: string[] = [];
  const spanRe = /<span[^>]*>([\s\S]*?)<\/span>/g;
  while ((m = spanRe.exec(block))) {
    const text = m[1].replace(/\\([{}])/g, "$1").replace(/&lt;/g, "<").trim();
    if (text) tags.push(text);
  }
  return summary.length > 0 ? { summary, tags } : null;
}

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
