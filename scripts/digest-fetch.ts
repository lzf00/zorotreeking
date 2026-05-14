/**
 * 每日 digest 抓取：
 *   - AI：Hugging Face Daily Papers → LLM 翻译摘要
 *   - 投资：同花顺 7×24 → LLM 精简改写
 *
 * 输出到 src/content/{ai,invest}/digest-YYYY-MM-DD.zh.mdx，默认 draft: true
 * 已存在的 digest 文件会跳过（幂等）。
 *
 * 本地：npx tsx scripts/digest-fetch.ts [ai|invest|both]
 * CI：每天 08:00 北京（00:00 UTC）由 .github/workflows/daily-digest.yml 触发
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchHFDailyPapers, type Paper } from "./digest-sources/ai.ts";
import { fetchTongHuaShunNews, type NewsItem } from "./digest-sources/invest.ts";
import { summarizeToChinese } from "./lib/llm.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "src", "content");

function todayInBeijing(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function escapeYaml(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, " ");
}

async function summarizeSafe(
  text: string,
  kind: "paper" | "news",
  fallback: string = "",
): Promise<string> {
  try {
    const out = await summarizeToChinese(text, { kind });
    if (out) return out;
    // 空响应：用原文截断当兜底，标注需人工
    const excerpt = fallback ? fallback.replace(/\s+/g, " ").slice(0, 300) : "";
    return excerpt
      ? `*（自动摘要失败，下面是原文节选，请手动改写）*\n\n${excerpt}${fallback.length > 300 ? "…" : ""}`
      : "（摘要为空，请手动补充）";
  } catch (e) {
    console.warn(`  [llm] summarize failed: ${(e as Error).message}`);
    return "（LLM 摘要失败，请稍后手动补充）";
  }
}

/** 限制并发的批处理：把任务分成 batchSize 一组顺序跑，组内并行 */
async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency = 3,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((it, j) => worker(it, i + j)));
    for (let k = 0; k < results.length; k++) out[i + k] = results[k];
    if (i + concurrency < items.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return out;
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

// ── AI ───────────────────────────────────────────────────────
async function buildAIDigest(date: string): Promise<void> {
  console.log("\n── AI digest ──");
  let papers: Paper[];
  try {
    papers = await fetchHFDailyPapers(date);
  } catch (e) {
    console.warn(`  fetch failed, try latest: ${(e as Error).message}`);
    papers = await fetchHFDailyPapers().catch(() => []);
  }
  if (papers.length === 0) {
    console.log("  no papers; skip.");
    return;
  }
  console.log(`  got ${papers.length} papers, summarizing...`);

  // 完全串行 + 短间隔，避免 LLM 端 burst rate 触发空返回
  const summaries: (Paper & { zhSummary: string })[] = [];
  const slice = papers.slice(0, 12);
  for (let i = 0; i < slice.length; i++) {
    const p = slice[i];
    console.log(`  [${i + 1}/${slice.length}] ${p.title.slice(0, 60)}`);
    const summary = await summarizeSafe(
      `Title: ${p.title}\n\nAbstract:\n${p.abstract}`,
      "paper",
      p.abstract,
    );
    summaries.push({ ...p, zhSummary: summary });
    if (i < slice.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  const lines: string[] = [];
  lines.push("---");
  lines.push(`lang: zh`);
  lines.push(`translationKey: digest-${date}`);
  lines.push(`title: "AI 每日精选 · ${date}"`);
  lines.push(`description: "来自 Hugging Face Daily Papers 的当日精选 ${summaries.length} 篇，AI 自动摘要待你审核"`);
  lines.push(`date: ${date}`);
  lines.push(`tags: [digest, auto, ai-papers]`);
  lines.push(`category: paper`);
  lines.push(`draft: true`);
  lines.push("---");
  lines.push("");
  lines.push(`> 自动从 [Hugging Face Daily Papers](https://huggingface.co/papers?date=${date}) 抓取，AI 摘要待审。Publish 前请检查并补充你的批注。`);
  lines.push("");

  for (let i = 0; i < summaries.length; i++) {
    const p = summaries[i];
    lines.push(`## ${i + 1}. ${p.title}`);
    lines.push("");
    if (p.authors.length > 0) {
      lines.push(`**作者**：${p.authors.slice(0, 5).join(", ")}${p.authors.length > 5 ? "…" : ""}  `);
    }
    if (p.upvotes != null) {
      lines.push(`**HF 投票**：${p.upvotes}  `);
    }
    lines.push(`**链接**：[arxiv](${p.url}) · [Hugging Face](${p.hfUrl})`);
    lines.push("");
    lines.push("**AI 摘要**：");
    lines.push("");
    lines.push(p.zhSummary);
    lines.push("");
    lines.push("> **我的批注**：（请在此处补充）");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const outPath = path.join(CONTENT_DIR, "ai", `digest-${date}.zh.mdx`);
  await writeIfNew(outPath, lines.join("\n"));
}

// ── 投资 ──────────────────────────────────────────────────────
async function buildInvestDigest(date: string): Promise<void> {
  console.log("\n── Invest digest ──");
  let news: NewsItem[];
  try {
    news = await fetchTongHuaShunNews(15);
  } catch (e) {
    console.warn(`  fetch failed: ${(e as Error).message}`);
    return;
  }
  if (news.length === 0) {
    console.log("  no news; skip.");
    return;
  }
  console.log(`  got ${news.length} news, summarizing...`);

  // 取前 10 条，逐条 LLM 改写为更精简的摘要
  const items: (NewsItem & { zhSummary: string })[] = [];
  const slice = news.slice(0, 10);
  for (let i = 0; i < slice.length; i++) {
    const n = slice[i];
    console.log(`  [${i + 1}/${slice.length}] ${n.title.slice(0, 50)}`);
    const summary = await summarizeSafe(`${n.title}\n\n${n.digest}`, "news", n.digest);
    items.push({ ...n, zhSummary: summary });
    if (i < slice.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  const lines: string[] = [];
  lines.push("---");
  lines.push(`lang: zh`);
  lines.push(`translationKey: digest-${date}`);
  lines.push(`title: "投资资讯日报 · ${date}"`);
  lines.push(`description: "同花顺 7×24 当日精选 ${items.length} 条快讯（AI 改写）"`);
  lines.push(`date: ${date}`);
  lines.push(`tags: [digest, auto, market-news]`);
  lines.push(`draft: true`);
  lines.push("---");
  lines.push("");
  lines.push("> 自动从 [同花顺 7×24](https://news.10jqka.com.cn/) 抓取，AI 改写摘要待审。不构成投资建议。");
  lines.push("");

  for (let i = 0; i < items.length; i++) {
    const n = items[i];
    const timeStr = new Date(n.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    lines.push(`## ${i + 1}. ${n.title}`);
    lines.push("");
    lines.push(`**时间**：${timeStr}  `);
    if (n.stocks && n.stocks.length > 0) {
      lines.push(`**涉及**：${n.stocks.slice(0, 5).join("、")}  `);
    }
    if (n.url) {
      lines.push(`**原文**：[同花顺](${n.url})`);
    }
    lines.push("");
    lines.push(n.zhSummary);
    lines.push("");
    lines.push("> **我的看法**：（请在此处补充）");
    lines.push("");
    lines.push("---");
    lines.push("");
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
