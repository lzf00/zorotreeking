/**
 * 行情接口报错的「人话化」（第 207 轮）。
 *
 * 线上实测（2026-11-26）：后端 `/api/market/stocks` 的上游（东财 + 腾讯兜底）同时挂了，
 * 接口返回
 *   {"ok":false,"error":"('Connection aborted.', RemoteDisconnected('Remote end closed
 *    connection without response')); tencent: tencent stock quotes empty"}
 * 而 6 个行情组件都是 `setError(d.error || L.loadFailed)` —— 于是**这句话原样出现在页面上**：
 * 英文 Python 异常、括号嵌套、还带内部实现细节（用了哪两家源站）。
 *
 * 两件事都不该发生：读者看不懂，而且把基础设施细节暴露给了外人。
 * 所以统一在这里翻译成"人话"，原始异常只进 console（排查用）。
 *
 * 判定顺序：频率限制 → 源站连不上 → 兜底。
 * 兜底一定是"加载失败"，**绝不回显原文** —— 宁可说得含糊，也不要把内部信息漏出去。
 */
import { marketLabels, type MarketLang } from "@/lib/market-i18n";

const RATE_LIMIT = /rate.?limit|too many requests|\b429\b|throttl/i;
const UNREACHABLE =
  /timeout|timed out|max retries|remoteDisconnected|connection (aborted|reset|refused|closed)|newconnectionerror|readtimeout|socket|sslv3|ssl|EOF occurred|EOF reached|eastmoney|tencent|push2|urllib3|requests\.exceptions/i;

/**
 * 把后端返回的 `error` 字段翻译成读者能懂的一句话。
 * @param raw 接口里原始的 error 字符串（可能为空、可能是 Python 异常文本）
 * @param lang 页面语言
 */
export function humanizeMarketError(raw: unknown, lang: MarketLang = "zh"): string {
  const L = marketLabels(lang);
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return L.networkError;
  if (RATE_LIMIT.test(text)) return L.rateLimited;
  if (UNREACHABLE.test(text)) return L.sourceUnreachable;
  return L.loadFailed;
}

/**
 * 这段文本里是否有"不该给读者看"的内部细节。
 * 只用于测试与守卫：真实渲染路径不会调用它。
 */
export function leaksInternalDetail(raw: unknown): boolean {
  const text = typeof raw === "string" ? raw : "";
  if (!text) return false;
  return UNREACHABLE.test(text) || /Traceback|File "|urllib3|requests\.exceptions|[A-Za-z]+Error\(/.test(text);
}

/**
 * 报错展示用的完整句子：优先用翻译后的人话，附一个"可以稍后再试"的出口。
 * 这样每个组件不用自己拼标点，也就不会拼出"加载失败：(: ..."这种东西。
 */
export function marketErrorSentence(raw: unknown, lang: MarketLang = "zh"): string {
  const L = marketLabels(lang);
  return `${humanizeMarketError(raw, lang)}${L.sentenceEnd}`;
}
