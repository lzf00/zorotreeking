import { getCollection } from "astro:content";
import type { APIContext } from "astro";

/**
 * 静态站点知识摘要（每次 build 生成）：给 AIChatWidget 后端拉去拼进 system prompt。
 *
 * 每个 section 抽最新 15 篇，字段：title / description / date / url。
 * 后端 `_load_site_knowledge()` 会 fetch 这个 JSON 后拼进 system prompt。
 *
 * 输出量：4 section × 15 篇 × ~200 字符 ≈ 12KB，塞进 8k tokens context 完全够。
 */

export async function GET(context: APIContext) {
  const [ai, invest, photo, hike] = await Promise.all([
    getCollection("ai", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("invest", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("photo", (p) => p.data.lang === "zh" && !p.data.draft),
    getCollection("hike", (p) => p.data.lang === "zh" && !p.data.draft),
  ]);

  const site = context.site?.toString().replace(/\/$/, "") || "https://www.zorotreeking.online";

  const take = (arr: any[], section: string, N = 15) =>
    arr
      .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
      .slice(0, N)
      .map((p) => ({
        title: p.data.title,
        description: p.data.description ?? "",
        date: p.data.date.toISOString().slice(0, 10),
        url: `${site}/${section}/${p.data.translationKey}`,
        tags: p.data.tags ?? [],
      }));

  const payload = {
    generated_at: new Date().toISOString(),
    site: {
      title: "ZoroTreeking",
      tagline: "在代码与山林之间，留一份缓慢的笔记。",
      description: "个人博客，四个板块：AI 学习、个人投资、摄影、徒步。作者 Zoro（刘子非），软件工程师。",
      url: site,
    },
    sections: {
      ai: { title: "AI 学习", desc: "AI 论文笔记、工具、思考", recent: take(ai, "ai") },
      invest: { title: "个人投资", desc: "A股 / 港股持仓、复盘、数据看板", recent: take(invest, "invest") },
      photo: { title: "摄影", desc: "镜头里的生活", recent: take(photo, "photo") },
      hike: { title: "徒步", desc: "路线、轨迹、风景", recent: take(hike, "hike") },
    },
    other_pages: [
      { title: "关于我", url: `${site}/about` },
      { title: "留言板", url: `${site}/guestbook` },
      { title: "订阅", url: `${site}/subscribe` },
      { title: "投资看板", url: `${site}/invest/portfolio` },
      { title: "ETF 三因子", url: `${site}/invest/etf` },
    ],
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
