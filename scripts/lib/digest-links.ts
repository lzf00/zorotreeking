/**
 * 日报标题要不要做成外链。
 *
 * 2026-11 的死链复盘：全站 66 个死链里 65 个是东方财富 7×24 快讯，
 * 剩下 1 个是同花顺。这类"快讯"稿件来源方当天跑完就删，我们的日报却是
 * 永久归档 —— 于是每篇日报第二天就带一堆 404，周扫每周都要重新处理一遍。
 *
 * 结论：会删稿的站点不做外链，标题只作为标题（章节小标题已经写明来源），
 * 稳定站点（arXiv / Hugging Face / 官方博客等）照旧给链接。
 */

/** 会删除当日稿件的来源站点。命中就不生成 `<a href>`。 */
export const VOLATILE_HEADLINE_HOSTS = [
  "eastmoney.com", // 东方财富 7×24 快讯
  "10jqka.com.cn", // 同花顺快讯
] as const;

/**
 * 标题是否应该渲染成外链。
 * @param href 已经过 `safeExternalUrl` 清洗的地址（`null` 表示没有可用链接）
 */
export function shouldLinkDigestHeadline(href: string | null | undefined): boolean {
  if (!href) return false;
  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return false;
  }
  return !VOLATILE_HEADLINE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}
