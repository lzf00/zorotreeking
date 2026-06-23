/**
 * 每日 digest 抓取（多源聚合）：
 *   AI 方向：
 *     - Hugging Face Daily Papers（精选高质量，~6 篇）
 *     - arxiv cs.LG（最新机器学习论文，~5 篇）
 *   投资方向：
 *     - 同花顺 7×24（~6 条）
 *     - 东方财富 7×24（~6 条）
 *
 *   流程：
 *     1) 各源并行 fetch，单源失败不阻塞
 *     2) 按 URL 去重
 *     3) 豆包逐条摘要（串行 + 重试，避开 burst rate）
 *     4) 按源分组写入 MDX（默认 draft: false 直接发布）
 *
 *   本地：npx tsx scripts/digest-fetch.ts [ai|invest|both]
 *   CI：每天 08:00 北京（00:00 UTC）由 .github/workflows/daily-digest.yml 触发
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchHFDailyPapers, type Paper } from "./digest-sources/ai.ts";
import { fetchArxivRSS } from "./digest-sources/ai-arxiv.ts";
import {
  fetchOpenAIBlog,
  fetchLilLog,
  fetchTheGradient,
  fetchGoogleResearch,
  fetchDeepMind,
  fetchHFBlog,
} from "./digest-sources/ai-blogs.ts";
import { fetchAnthropicNews } from "./digest-sources/ai-anthropic.ts";
import { fetchQbitAI } from "./digest-sources/ai-qbitai.ts";
import { fetchTongHuaShunNews, type NewsItem } from "./digest-sources/invest.ts";
import { fetchEastmoneyNews } from "./digest-sources/invest-eastmoney.ts";
import { fetchYahooFinance } from "./digest-sources/invest-yahoo.ts";
import { summarizeToChinese, digestTLDR, type DigestTLDR } from "./lib/llm.ts";
import { pickCoverFromLibrary } from "./lib/cover-picker.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "src", "content");

// Section 标题不带 emoji——详情页在 prose 里把它弱化为 uppercase 小字。
const SOURCE_LABEL: Record<string, string> = {
  "hf-daily": "Hugging Face Daily Papers",
  "hf-blog": "Hugging Face Blog",
  "arxiv": "arXiv cs.LG",
  "openai-blog": "OpenAI",
  "anthropic": "Anthropic News",
  "google-research": "Google Research",
  "deepmind": "Google DeepMind",
  "thegradient": "The Gradient",
  "lillog": "Lil'Log",
  "qbitai": "量子位",
  "10jqka": "同花顺 7×24",
  "eastmoney": "东方财富 7×24",
  "yahoo-finance": "Yahoo Finance",
};

function todayInBeijing(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

/**
 * MDX 转义：
 *  - 危险 HTML 标签（script/iframe/style/object/embed/link/meta/base）的 `<` → `&lt;`
 *    （MDX 编译会把这些标签当作 JSX 组件渲染，若外部 RSS 原文含 `<script>` 会被执行）
 *  - `<` 后跟非字母 → `&lt;`（不然被当作 JSX 标签开头）
 *  - `{` `}` → `\{` `\}`（不然被当作 JSX 表达式块；arxiv 作者名 LaTeX 转义如 `{\o}`、`{\ae}` 频繁出现）
 */
function sanitizeForMdx(s: string): string {
  const DANGEROUS_TAGS = /<(\/?)(script|iframe|style|object|embed|link|meta|base)\b/gi;
  return s
    .replace(DANGEROUS_TAGS, "&lt;$1$2")
    .replace(/<(?![a-zA-Z!/])/g, "&lt;")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/**
 * 把 (source, url) 映射成稳定的 item slug，用于 feedback 按钮。
 * 优先用 URL 中的长数字 ID（arxiv/同花顺/东方财富/量子位 都有）；
 * 否则用 URL 最后一段路径；最后兜底用简单哈希。
 */
function itemSlug(source: string, url: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  if (!url) return `${source}-unknown`;
  const numMatch = url.match(/(\d{6,})/);
  if (numMatch) return `${source}-${numMatch[1]}`;
  const arxivMatch = url.match(/arxiv\.org\/abs\/([\w.]+)/);
  if (arxivMatch) return `arxiv-${safe(arxivMatch[1])}`;
  const lastSeg = url.replace(/\/$/, "").split("/").pop() || "";
  if (lastSeg) return `${source}-${safe(lastSeg)}`;
  // 兜底
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return `${source}-${(h >>> 0).toString(36)}`;
}

/**
 * 把 TL;DR + tags 渲染成 MDX 顶部的浓缩区。无 TL;DR 时返回空数组。
 */
function renderTLDR(tldr: DigestTLDR | null): string[] {
  if (!tldr || !tldr.summary?.length) return [];
  const lines: string[] = [];
  lines.push('<div className="not-prose my-8 p-5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40">');
  lines.push('  <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 mb-3 font-mono">TL;DR · 30 秒看完今日</div>');
  lines.push('  <ul className="space-y-1.5 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 list-none p-0 m-0">');
  for (const s of tldr.summary) {
    lines.push(`    <li className="pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[10px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-400">${escapeJsxText(s)}</li>`);
  }
  lines.push('  </ul>');
  if (tldr.tags?.length) {
    lines.push('  <div className="mt-4 flex flex-wrap gap-2">');
    for (const tag of tldr.tags) {
      lines.push(`    <span className="text-[12px] px-2 py-0.5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">${escapeJsxText(tag)}</span>`);
    }
    lines.push('  </div>');
  }
  lines.push('</div>');
  lines.push('');
  return lines;
}
function escapeJsxText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/</g, "&lt;");
}

async function summarizeSafe(
  text: string,
  kind: "paper" | "news",
  fallback: string = "",
): Promise<string> {
  try {
    const out = await summarizeToChinese(text, { kind });
    if (out) return out;
    const excerpt = fallback ? fallback.replace(/\s+/g, " ").slice(0, 300) : "";
    return excerpt
      ? `*（自动摘要失败，下面是原文节选，请手动改写）*\n\n${excerpt}${fallback.length > 300 ? "…" : ""}`
      : "（摘要为空，请手动补充）";
  } catch (e) {
    console.warn(`  [llm] summarize failed: ${(e as Error).message}`);
    return "（LLM 摘要失败，请稍后手动补充）";
  }
}

async function writeIfNew(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    console.log(`  → already exists, skip: ${path.relative(ROOT, filePath)}`);
    return false;
  } catch {
    // not exists, write
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  console.log(`  ✓ wrote: ${path.relative(ROOT, filePath)}`);
  return true;
}

// 多源并行收集 + URL 去重 + 每源 limit
async function collectFromSources<T extends { url?: string }>(
  sources: { name: string; fetch: () => Promise<T[]>; limit: number }[],
): Promise<T[]> {
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));
  const seen = new Set<string>();
  const out: T[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = sources[i];
    if (r.status === "rejected") {
      console.warn(`  ✗ source ${src.name} failed: ${(r.reason as Error).message}`);
      continue;
    }
    const got = r.value.slice(0, src.limit);
    console.log(`  ✓ source ${src.name}: ${got.length} items`);
    for (const it of got) {
      const key = (it.url || "").trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(it);
    }
  }
  return out;
}

// ── AI ───────────────────────────────────────────────────────
async function buildAIDigest(date: string): Promise<void> {
  console.log("\n── AI digest ──");
  const papers = await collectFromSources<Paper>([
    { name: "Hugging Face Daily", fetch: () => fetchHFDailyPapers(date).catch(() => fetchHFDailyPapers()), limit: 5 },
    { name: "arxiv cs.LG",        fetch: () => fetchArxivRSS("cs.LG", 3), limit: 3 },
    { name: "OpenAI Blog",        fetch: () => fetchOpenAIBlog(14, 2),    limit: 2 },
    { name: "Anthropic News",     fetch: () => fetchAnthropicNews(2),     limit: 2 },
    { name: "Google Research",    fetch: () => fetchGoogleResearch(30, 2), limit: 2 },
    { name: "DeepMind",           fetch: () => fetchDeepMind(45, 2),      limit: 2 },
    { name: "Hugging Face Blog",  fetch: () => fetchHFBlog(14, 2),        limit: 2 },
    { name: "The Gradient",       fetch: () => fetchTheGradient(180, 1),  limit: 1 },
    { name: "Lil'Log",            fetch: () => fetchLilLog(180, 1),       limit: 1 },
    { name: "量子位",              fetch: () => fetchQbitAI(3),            limit: 3 },
  ]);
  if (papers.length === 0) {
    console.log("  no papers; skip.");
    return;
  }
  console.log(`  total ${papers.length} papers after dedupe, summarizing...`);

  const summaries: (Paper & { zhSummary: string })[] = [];
  for (let i = 0; i < papers.length; i++) {
    const p = papers[i];
    console.log(`  [${i + 1}/${papers.length}] (${p.source}) ${p.title.slice(0, 60)}`);
    const summary = await summarizeSafe(
      `Title: ${p.title}\n\nAbstract:\n${p.abstract}`,
      "paper",
      p.abstract,
    );
    summaries.push({ ...p, zhSummary: summary });
    if (i < papers.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  const grouped: Record<string, (Paper & { zhSummary: string })[]> = {};
  for (const s of summaries) {
    (grouped[s.source] ??= []).push(s);
  }

  // tag 主题化：digest + auto 保留，按 source 自动派生具体主题 tag。
  // 老的 [digest, auto, ai-papers] 三个固定 tag 检索没价值。
  const sourceTagMap: Record<string, string> = {
    "hf-daily": "hf-papers",
    "hf-blog": "hf-blog",
    "arxiv": "arxiv",
    "openai-blog": "openai",
    "anthropic": "anthropic",
    "google-research": "google-research",
    "deepmind": "deepmind",
    "thegradient": "the-gradient",
    "lillog": "lil-log",
    "qbitai": "qbitai",
  };
  const themeTags = Array.from(new Set(
    Object.keys(grouped).map((k) => sourceTagMap[k] ?? k).filter(Boolean),
  ));
  const tagList = ["digest", "auto", ...themeTags].slice(0, 8);

  // ── TL;DR：浓缩到 3 句话 + 5 个 emoji 标签 ────────────────────
  console.log("  generating TL;DR…");
  const titleBrief = summaries.map((p, i) => `${i + 1}. [${p.source}] ${p.title}`).join("\n");
  const tldr = await digestTLDR("ai", titleBrief).catch(() => null);

  // ── 封面图：从本站相册库随机选一张（同一天选同一张） ───────────
  const coverPath = await pickCoverFromLibrary(`ai-${date}`).catch(() => null);
  if (coverPath) console.log(`  cover picked: ${coverPath}`);

  const lines: string[] = [];
  lines.push("---");
  lines.push(`lang: zh`);
  lines.push(`translationKey: digest-${date}`);
  lines.push(`title: "AI 每日精选 · ${date}"`);
  lines.push(`description: "${summaries.length} 篇论文 · 多源聚合 + AI 摘要"`);
  lines.push(`date: ${date}`);
  lines.push(`tags: [${tagList.join(", ")}]`);
  lines.push(`category: paper`);
  if (coverPath) lines.push(`cover: "${coverPath}"`);
  lines.push(`draft: false`);
  lines.push("---");
  lines.push("");
  lines.push('import FeedbackButtons from "@/components/FeedbackButtons";');
  lines.push("");
  // TL;DR 浓缩区（不阻塞主流程，没有就不渲染）
  for (const l of renderTLDR(tldr)) lines.push(l);

  for (const sourceKey of Object.keys(grouped)) {
    const label = SOURCE_LABEL[sourceKey] || sourceKey;
    lines.push(`# ${label}`);
    lines.push("");
    for (const p of grouped[sourceKey]) {
      // 标题本身是外链（点击新窗口打开 arxiv）。URL 中的 " 转义掉避免破属性。
      // 不带编号——苹果 newsroom 每篇 article 独立，编号是 noise。
      const arxivHref = (p.url || "").replace(/"/g, "%22");
      lines.push(`## <a href="${arxivHref}" target="_blank" rel="noopener noreferrer">${sanitizeForMdx(p.title)}</a>`);
      lines.push("");
      // meta 合并单行：HF ★ N · 作者前 3 个… · HF 镜像
      const metaParts: string[] = [];
      if (p.upvotes != null) metaParts.push(`HF ★ ${p.upvotes}`);
      if (p.authors.length > 0) {
        const authorStr = p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? "…" : "");
        metaParts.push(sanitizeForMdx(authorStr));
      }
      if (p.hfUrl) metaParts.push(`[HF 镜像](${p.hfUrl})`);
      if (metaParts.length > 0) {
        lines.push(`*${metaParts.join(" · ")}*`);
        lines.push("");
      }
      lines.push(sanitizeForMdx(p.zhSummary));
      lines.push("");
      lines.push(`<FeedbackButtons slug="item:${itemSlug(p.source, p.url)}" client:visible />`);
      lines.push("");
    }
  }

  const outPath = path.join(CONTENT_DIR, "ai", `digest-${date}.zh.mdx`);
  await writeIfNew(outPath, lines.join("\n"));
}

// ── 投资 ──────────────────────────────────────────────────────
async function buildInvestDigest(date: string): Promise<void> {
  console.log("\n── Invest digest ──");
  const news = await collectFromSources<NewsItem>([
    { name: "同花顺 7×24",    fetch: () => fetchTongHuaShunNews(8), limit: 6 },
    { name: "东方财富 7×24",   fetch: () => fetchEastmoneyNews(8),    limit: 6 },
    { name: "Yahoo Finance", fetch: () => fetchYahooFinance(3),     limit: 3 },
  ]);
  if (news.length === 0) {
    console.log("  no news; skip.");
    return;
  }
  console.log(`  total ${news.length} news after dedupe, summarizing...`);

  const items: (NewsItem & { zhSummary: string })[] = [];
  for (let i = 0; i < news.length; i++) {
    const n = news[i];
    console.log(`  [${i + 1}/${news.length}] (${n.source}) ${n.title.slice(0, 50)}`);
    const summary = await summarizeSafe(`${n.title}\n\n${n.digest}`, "news", n.digest);
    items.push({ ...n, zhSummary: summary });
    if (i < news.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  const grouped: Record<string, (NewsItem & { zhSummary: string })[]> = {};
  for (const it of items) {
    (grouped[it.source] ??= []).push(it);
  }

  const lines: string[] = [];
  // tag 主题化：按本批新闻里出现的 source 派生具体标签
  const investSourceTagMap: Record<string, string> = {
    "10jqka": "tonghuashun",
    "eastmoney": "eastmoney",
    "yahoo-finance": "yahoo",
  };
  const themeTags = Array.from(new Set(
    Object.keys(grouped).map((k) => investSourceTagMap[k] ?? k).filter(Boolean),
  ));
  const tagList = ["digest", "auto", "market-news", ...themeTags].slice(0, 8);

  // ── TL;DR + 封面图（封面图来自本站相册库） ─────────────────────
  console.log("  generating TL;DR…");
  const titleBrief = items.map((n, i) => `${i + 1}. [${n.source}] ${n.title}`).join("\n");
  const tldr = await digestTLDR("invest", titleBrief).catch(() => null);
  const coverPath = await pickCoverFromLibrary(`invest-${date}`).catch(() => null);
  if (coverPath) console.log(`  cover picked: ${coverPath}`);

  lines.push("---");
  lines.push(`lang: zh`);
  lines.push(`translationKey: digest-${date}`);
  lines.push(`title: "投资资讯日报 · ${date}"`);
  lines.push(`description: "${items.length} 条快讯 · 多源聚合 + AI 改写"`);
  lines.push(`date: ${date}`);
  lines.push(`tags: [${tagList.join(", ")}]`);
  if (coverPath) lines.push(`cover: "${coverPath}"`);
  lines.push(`draft: false`);
  lines.push("---");
  lines.push("");
  lines.push('import FeedbackButtons from "@/components/FeedbackButtons";');
  lines.push("");
  lines.push("> 由 cron 每日 08:00 北京自动从同花顺 + 东方财富抓取，豆包改写摘要。**仅作信息整理，不构成投资建议。**");
  lines.push("");
  // TL;DR
  for (const l of renderTLDR(tldr)) lines.push(l);

  for (const sourceKey of Object.keys(grouped)) {
    const label = SOURCE_LABEL[sourceKey] || sourceKey;
    lines.push(`# ${label}`);
    lines.push("");
    for (const n of grouped[sourceKey]) {
      const timeStr = new Date(n.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      // 标题本身就是原文外链（新窗口）；不带编号
      const newsHref = (n.url || "").replace(/"/g, "%22");
      if (newsHref) {
        lines.push(`## <a href="${newsHref}" target="_blank" rel="noopener noreferrer">${sanitizeForMdx(n.title)}</a>`);
      } else {
        lines.push(`## ${sanitizeForMdx(n.title)}`);
      }
      lines.push("");
      // meta 合并单行：时间 · 涉及：A, B, C
      const metaParts: string[] = [timeStr];
      if (n.stocks && n.stocks.length > 0) {
        metaParts.push(`涉及：${n.stocks.slice(0, 5).join("、")}`);
      }
      lines.push(`*${metaParts.join(" · ")}*`);
      lines.push("");
      lines.push(sanitizeForMdx(n.zhSummary));
      lines.push("");
      lines.push(`<FeedbackButtons slug="item:${itemSlug(n.source, n.url)}" client:visible />`);
      lines.push("");
    }
  }

  const outPath = path.join(CONTENT_DIR, "invest", `digest-${date}.zh.mdx`);
  await writeIfNew(outPath, lines.join("\n"));
}

// ── 入口 ──────────────────────────────────────────────────────
async function main() {
  const arg = (process.argv[2] || "both").toLowerCase();
  const date = todayInBeijing();
  console.log(`[digest] target date: ${date} (Asia/Shanghai)`);
  console.log(`[digest] mode: ${arg}`);

  if (arg === "ai" || arg === "both") await buildAIDigest(date);
  if (arg === "invest" || arg === "both") await buildInvestDigest(date);

  console.log("\n[digest] done.");
}

main().catch((e) => {
  console.error("[digest] fatal:", e);
  process.exit(1);
});
