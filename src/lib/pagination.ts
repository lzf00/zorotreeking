/**
 * 静态分页的通用算术（第 189 轮起，第 190 轮抽出公共部分）。
 *
 * 站点是纯静态的：没有运行时分页，只有"构建期把一页切成 N 页"。切成几页这件事必须
 * 被**页面**和 **sitemap** 用同一套算术算出来 —— 只要两处各自算一遍，某个方向一改
 * 就会写出服务器上不存在的 URL，而 `check:seo` 有一条"可索引但不在 sitemap"和一条
 * "sitemap 列出的页面不存在"的硬规则，两边都会判红（第 189 轮真踩过）。
 */

/** 总数 → 页数（至少 1 页）。 */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * 第 2 页起的路径（第一页就是 base 本身）：`/archive` → `/archive/2`、`/archive/3`……
 * `base` 带语言前缀（`/en/archive`），尾斜杠由调用方统一处理。
 */
export function pagePaths(base: string, total: number, pageSize: number): string[] {
  const pages = pageCount(total, pageSize);
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => `${base}/${i + 2}`);
}

/** 语言前缀互换：`/archive` ↔ `/en/archive`（分页页要按同一页码和中英对端互链）。 */
export function counterpartBase(base: string): string {
  return base.startsWith("/en/") ? base.slice(3) : `/en${base}`;
}

/** `Astro.props` 里 `paginate()` 给的 page 对象（自己声明，否则类型会退化成 never）。 */
export interface PaginatedPage<T> {
  data: T[];
  start: number;
  end: number;
  total: number;
  currentPage: number;
  size: number;
  lastPage: number;
  url: { current: string; prev?: string; next?: string; first?: string; last?: string };
}
