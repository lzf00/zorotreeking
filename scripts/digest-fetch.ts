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
import { fetchOpenAIBlog, fetchLilLog } from "./digest-sources/ai-blogs.ts";
import { fetchAnthropicNews } from "./digest-sources/ai-anthropic.ts";
import { fetchQbitAI } from "./digest-sources/ai-qbitai.ts";
import { fetchTongHuaShunNews, type NewsItem } from "./digest-sources/invest.ts";
import { fetchEastmoneyNews } from "./digest-sources/invest-eastmoney.ts";
import { summarizeToChinese } from "./lib/llm.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "src", "content");

const SOURCE_LABEL: Record<string, string> = {
  "hf-daily": "🤗 Hugging Face Daily Papers",
  "arxiv": "📄 arXiv cs.LG（机器学习）",
  "openai-blog": "🟢 OpenAI 官方动态",
  "anthropic": "🪶 Anthropic News",
  "lillog": "✍️ Lil'Log（Lilian Weng）",
  "qbitai": "⚡ 量子位",
  "10jqka": "📱 同花顺 7×24",
  "eastmoney": "🟢 东方财富 7×24",
};

function todayInBeijing(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

/**
 * MDX 转义：MDX 把 `<` 后跟非字母字符当作错误的 JSX 起手
 * （`<1%` / `<a>` 没问题但 `<1`、`<x>` 都会炸）
 * 把不像 JSX 标签开头的 `<` 转成 `&lt;`
 */
function sanitizeForMdx(s: string): string {
  return s.replace(/<(?![a-zA-Z!/])/g, "&lt;");
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
    {
      name: "Hugging Face Daily",
      fetch: () => fetchHFDailyPapers(date).catch(() => fetchHFDailyPapers()),
      limit: 6,
    },
    {
      name: "arxiv cs.LG",
      fetch: () => fetchArxivRSS("cs.LG", 4),
      limit: 4,
    },
    {
      name: "OpenAI Blog",
      fetch: () => fetchOpenAIBlog(14, 3),
      limit: 3,
    },
    {
      name: "Anthropic News",
      fetch: () => fetchAnthropicNews(3),
      limit: 3,
    },
    {
      name: "量子位",
      fetch: () => fetchQbitAI(4),
      limit: 4,
    },
    {
      name: "Lil'Log",
      fetch: () => fetchLilLog(180, 2),
      limit: 2,
    },
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

  const lines: string[] = [];
  lines.push("---");
  lines.push(`lang: zh`);
  lines.push(`translationKey: digest-${date}`);
  lines.push(`title: "AI 每日精选 · ${date}"`);
  lines.push(`description: "${summaries.length} 篇论文 · 多源聚合 + AI 摘要"`);
  lines.push(`date: ${date}`);
  lines.push(`tags: [digest, auto, ai-papers]`);
  lines.push(`category: paper`);
  lines.push(`draft: false`);
  lines.push("---");
  lines.push("");
  lines.push(`> 由 cron 每日 08:00 北京自动从 HF Daily Papers + arxiv cs.LG 抓取，豆包翻译/摘要。仅供参考。`);
  lines.push("");

  let globalIdx = 0;
  for (const sourceKey of Object.keys(grouped)) {
    const label = SOURCE_LABEL[sourceKey] || sourceKey;
    lines.push(`# ${label}`);
    lines.push("");
    for (const p of grouped[sourceKey]) {
      globalIdx++;
      lines.push(`## ${globalIdx}. ${p.title}`);
      lines.push("");
      if (p.authors.length > 0) {
        lines.push(`**作者**：${p.authors.slice(0, 5).join(", ")}${p.authors.length > 5 ? "…" : ""}  `);
      }
      if (p.upvotes != null) {
        lines.push(`**HF 投票**：${p.upvotes}  `);
      }
      const linkParts = [`[arxiv](${p.url})`];
      if (p.hfUrl) linkParts.push(`[Hugging Face](${p.hfUrl})`);
      lines.push(`**链接**：${linkParts.join(" · ")}`);
      lines.push("");
      lines.push("**AI 摘要**：");
      lines.push("");
      lines.push(sanitizeForMdx(p.zhSummary));
      lines.push("");
      lines.push("---");
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
    {
      name: "同花顺 7×24",
      fetch: () => fetchTongHuaShunNews(8),
      limit: 6,
    },
    {
      name: "东方财富 7×24",
      fetch: () => fetchEastmoneyNews(8),
      limit: 6,
    },
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
  lines.push("---");
  lines.push(`lang: zh`);
  lines.push(`translationKey: digest-${date}`);
  lines.push(`title: "投资资讯日报 · ${date}"`);
  lines.push(`description: "${items.length} 条快讯 · 多源聚合 + AI 改写"`);
  lines.push(`date: ${date}`);
  lines.push(`tags: [digest, auto, market-news]`);
  lines.push(`draft: false`);
  lines.push("---");
  lines.push("");
  lines.push("> 由 cron 每日 08:00 北京自动从同花顺 + 东方财富抓取，豆包改写摘要。**仅作信息整理，不构成投资建议。**");
  lines.push("");

  let globalIdx = 0;
  for (const sourceKey of Object.keys(grouped)) {
    const label = SOURCE_LABEL[sourceKey] || sourceKey;
    lines.push(`# ${label}`);
    lines.push("");
    for (const n of grouped[sourceKey]) {
      globalIdx++;
      const timeStr = new Date(n.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      lines.push(`## ${globalIdx}. ${n.title}`);
      lines.push("");
      lines.push(`**时间**：${timeStr}  `);
      if (n.stocks && n.stocks.length > 0) {
        lines.push(`**涉及**：${n.stocks.slice(0, 5).join("、")}  `);
      }
      if (n.url) {
        lines.push(`**原文**：[${label.replace(/^.\s/, "")}](${n.url})`);
      }
      lines.push("");
      lines.push(sanitizeForMdx(n.zhSummary));
      lines.push("");
      lines.push("---");
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
