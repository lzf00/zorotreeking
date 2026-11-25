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
import { counterpartBase as sharedCounterpart, pageCount, pagePaths, type PaginatedPage } from "./pagination";

export type { PaginatedPage };

export const DIGEST_PAGE_SIZE = 48;

/** 给定总数算出页数（至少 1 页）。 */
export function digestPageCount(total: number, pageSize = DIGEST_PAGE_SIZE): number {
  return pageCount(total, pageSize);
}

/**
 * 分页页的路径（不含第一页）：`/ai/digest/` → `/ai/digest/2/`、`/ai/digest/3/`……
 * `basePath` 带语言前缀（`/en/ai/digest`），尾斜杠由调用方统一处理。
 */
export function digestPagePaths(basePath: string, total: number, pageSize = DIGEST_PAGE_SIZE): string[] {
  return pagePaths(basePath, total, pageSize);
}

/** 语言前缀互换：`/ai/digest` ↔ `/en/ai/digest`（分页页要按同一页码互链）。 */
export function counterpartBase(base: string): string {
  return sharedCounterpart(base);
}
