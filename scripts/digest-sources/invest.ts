/**
 * 投资方向数据源：同花顺 7×24 快讯
 *
 * 端点：https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=20
 * 公开 JSON，免 key，每页 ~20 条，按时间倒序
 */

export type NewsItem = {
  source: "10jqka" | "eastmoney" | "yahoo-finance";
  title: string;
  digest: string;       // 中文原文（已经是中文，不需要翻译，只需要 LLM 改写更精炼）
  url: string;
  publishedAt: string;  // ISO 时间
  tags?: string[];
  stocks?: string[];    // 涉及的股票代码
};

export async function fetchTongHuaShunNews(limit = 20): Promise<NewsItem[]> {
  const url = `https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=${limit}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 zorotreeking-digest/1.0",
      Referer: "https://news.10jqka.com.cn/",
    },
  });
  if (!resp.ok) throw new Error(`THS ${resp.status}`);
  const data = (await resp.json()) as {
    data?: {
      list?: Array<{
        title?: string;
        digest?: string;
        url?: string;
        ctime?: string;       // 秒级 unix timestamp（字符串形式）
        tags?: { name?: string }[];
        stock?: { stockcode?: string; stockname?: string }[];
      }>;
    };
  };
  const list = data.data?.list ?? [];
  return list
    .filter((it) => it.title)
    .map((it) => ({
      source: "10jqka" as const,
      title: (it.title ?? "").trim(),
      digest: (it.digest ?? "").trim(),
      url: it.url ?? "",
      publishedAt: it.ctime
        ? new Date(Number(it.ctime) * 1000).toISOString()
        : new Date().toISOString(),
      tags: (it.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
      stocks: (it.stock ?? [])
        .filter((s) => s && s.stockname && s.stockcode)
        .map((s) => `${s.stockname}(${s.stockcode})`),
    }));
}
