/**
 * 日报索引的分页参数（第 189 轮）。
 *
 * 背景：四个日报归档页（zh/en × ai/invest）都把**全部期数**渲染进同一页，
 * 每页 220–230 KB HTML、DOM 里几百行卡片。第 133 轮已经砍掉一半（429 KB → 213 KB），
 * 但那是"不再配图"，条目数还是一条不少地堆着。
 *
 * 全站 1210 页里 HTML 超 220 KB 的就这几页 —— 按 48 期一页切，每页落到 ~60 KB，
 * 而"最新 6 期出大卡片"只留在第一页（新读者要看的正是那 6 期）。
 *
 * 这个常量必须被**分页页**和 **sitemap 生成器**同时引用：第 56 轮踩过一次
 * "sitemap 漏收录可索引页面"的坑，分页页如果忘了进 sitemap，`check:seo` 直接判红。
 */
export const DIGEST_PAGE_SIZE = 48;

/** 给定总数算出页数（至少 1 页）。 */
export function digestPageCount(total: number, pageSize = DIGEST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * 分页页的路径（不含第一页）：`/ai/digest/` → `/ai/digest/2/`、`/ai/digest/3/`……
 * `basePath` 带语言前缀（`/en/ai/digest`），尾斜杠由调用方统一处理。
 */
export function digestPagePaths(basePath: string, total: number, pageSize = DIGEST_PAGE_SIZE): string[] {
  const pages = digestPageCount(total, pageSize);
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => `${basePath}/${i + 2}`);
}

/**
 * `paginate()` 返回的 page 对象（Astro 的 `PaginateResult`）。
 *
 * 为什么要自己写：`getStaticPaths({ paginate }: { paginate: any })` 的返回类型退化成 any，
 * Astro 于是把 `Astro.props` 推成 `never`，`page.url.prev` 这类访问全是 ts(2339)。
 * 显式声明一次，四个页面共用。
 */
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

/** 语言前缀互换：`/ai/digest` ↔ `/en/ai/digest`（分页页要按同一页码互链）。 */
export function counterpartBase(base: string): string {
  return base.startsWith("/en/") ? base.slice(3) : `/en${base}`;
}
