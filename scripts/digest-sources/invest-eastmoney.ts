/**
 * 东方财富 7×24 快讯（JSONP 形式公开接口）
 *
 * 端点：https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_<pageSize>_1_.html
 *   返回 `var ajaxResult={...}` 形式，需要剥壳
 */
import type { NewsItem } from "./invest.ts";

export async function fetchEastmoneyNews(limit = 15): Promise<NewsItem[]> {
  const url = `https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_${limit}_1_.html`;
  const resp = await fetch(url, {
    headers: {
      Referer: "https://kuaixun.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 zorotreeking-digest/1.0",
    },
  });
  if (!resp.ok) throw new Error(`eastmoney ${resp.status}`);

  const text = await resp.text();
  const m = text.match(/var\s+\w+\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!m) throw new Error("eastmoney response not parseable");
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`eastmoney json parse: ${(e as Error).message}`);
  }
  const list = data.LivesList ?? [];

  return list
    .filter((it: any) => it?.title)
    .map((it: any) => ({
      source: "eastmoney" as const,
      title: String(it.title || "").trim(),
      digest: String(it.digest || it.simtitle || "")
        .replace(/^【[^】]+】/, "") // 去除 "【...】" 前缀
        .trim(),
      url: it.url_w || it.url_m || "",
      publishedAt: parseEastmoneySort(it.sort, it.showtime),
      tags: [],
      stocks: [],
    }))
    .slice(0, limit);
}

function parseEastmoneySort(sort?: string, showtime?: string): string {
  // sort 是个 19 位毫秒时间戳的拼接（前 13 位是毫秒）
  if (sort) {
    const ms = Number(String(sort).slice(0, 13));
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  if (showtime) {
    // showtime 形如 "2026-05-14 14:54:00"
    const d = new Date(showtime.replace(" ", "T") + "+08:00");
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}
