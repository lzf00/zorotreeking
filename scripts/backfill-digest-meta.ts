/**
 * 给历史 digest 文章回填两样东西：
 *   1) frontmatter 的 cover 字段（从 photo-manifest 相册随机选一张横版图）
 *   2) MDX 顶部的 TL;DR 浓缩区（豆包 doubao 出 3 句话 + 5 emoji 标签）
 *
 * 处理对象：
 *   - src/content/ai/digest-*.zh.mdx
 *   - src/content/invest/digest-*.zh.mdx
 *   - 已有 cover 或已有 TL;DR 区块的文章 → 跳过对应那一项（增量）
 *   - --force 强制重写
 *   - --limit=N 限制本次处理多少篇（默认全量）
 *   - --kind=ai|invest 只处理某一类
 *
 * 用法：
 *   npx tsx scripts/backfill-digest-meta.ts
 *   npx tsx scripts/backfill-digest-meta.ts --limit=10 --kind=ai
 *   npx tsx scripts/backfill-digest-meta.ts --force --tldr-only
 *
 * 注意：cover 从本站相册取（pickCoverFromLibrary），不调外部 API；
 *       TL;DR 调豆包 chat，需要 DOUBAO_API_KEY。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestTLDR, type DigestTLDR } from "./lib/llm.ts";
import { pickCoverFromLibrary } from "./lib/cover-picker.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const TLDR_ONLY = ARGS.includes("--tldr-only");
const COVER_ONLY = ARGS.includes("--cover-only");
const LIMIT = (() => {
  const a = ARGS.find((x) => x.startsWith("--limit="));
  return a ? parseInt(a.split("=")[1], 10) || Infinity : Infinity;
})();
const KIND_FILTER = (() => {
  const a = ARGS.find((x) => x.startsWith("--kind="));
  return a ? (a.split("=")[1] as "ai" | "invest") : null;
})();

/** 标题列表用于 TL;DR 输入。从 mdx 抓 H2 块。 */
function extractTitles(mdxBody: string): string[] {
  const titles: string[] = [];
  const re = /^##\s+(?:<a[^>]*>)?([^<\n]+?)(?:<\/a>)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mdxBody))) {
    const t = m[1].trim();
    if (t) titles.push(t);
  }
  return titles;
}

/** 把 TL;DR 渲染成 MDX 顶部块（与 digest-fetch 里 renderTLDR 一致）。 */
function renderTLDRBlock(tldr: DigestTLDR): string {
  const lines: string[] = [];
  lines.push('<div className="not-prose my-8 p-5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40">');
  lines.push('  <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 mb-3 font-mono">TL;DR · 30 秒看完今日</div>');
  lines.push('  <ul className="space-y-1.5 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 list-none p-0 m-0">');
  for (const s of tldr.summary) {
    const esc = s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/</g, "&lt;");
    lines.push(`    <li className="pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[10px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-400">${esc}</li>`);
  }
  lines.push('  </ul>');
  if (tldr.tags?.length) {
    lines.push('  <div className="mt-4 flex flex-wrap gap-2">');
    for (const tag of tldr.tags) {
      const esc = tag.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/</g, "&lt;");
      lines.push(`    <span className="text-[12px] px-2 py-0.5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">${esc}</span>`);
    }
    lines.push('  </div>');
  }
  lines.push('</div>');
  return lines.join("\n");
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const TLDR_MARKER = "TL;DR · 30 秒看完今日";

type Parsed = {
  frontmatter: string;
  body: string;
};
function parseMdx(text: string): Parsed | null {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return null;
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

function hasField(fm: string, field: string): boolean {
  return new RegExp(`^${field}\\s*:`, "m").test(fm);
}

function injectCover(fm: string, coverPath: string): string {
  if (hasField(fm, "cover") && !FORCE) return fm;
  // 移除旧 cover
  let next = fm.replace(/^cover\s*:.*\n?/m, "");
  // 插在 draft: 行前；找不到就 append
  if (/^draft\s*:/m.test(next)) {
    next = next.replace(/^draft\s*:/m, `cover: "${coverPath}"\ndraft:`);
  } else {
    next = next.trimEnd() + `\ncover: "${coverPath}"`;
  }
  return next;
}

function injectTLDR(body: string, block: string): string {
  // 删除旧 TL;DR 块（如果有）
  let next = body;
  if (next.includes(TLDR_MARKER)) {
    // 匹配整段 <div> ... TL;DR ... </div> 块
    next = next.replace(/<div[^>]*>[\s\S]*?TL;DR[\s\S]*?<\/div>\s*\n?/, "");
  }
  // 找到 import FeedbackButtons 行，在它下面空行后插入
  const importRe = /^(import\s+FeedbackButtons[^\n]+\n)/m;
  if (importRe.test(next)) {
    next = next.replace(importRe, (_, p1) => `${p1}\n${block}\n`);
  } else {
    // 兜底：直接放在 body 最前
    next = `${block}\n\n${next}`;
  }
  return next;
}

async function processOne(
  filePath: string,
  date: string,
  kind: "ai" | "invest",
): Promise<{ touched: boolean; coverAdded: boolean; tldrAdded: boolean; rel: string }> {
  const rel = path.relative(ROOT, filePath);
  const text = await fs.readFile(filePath, "utf-8");
  const parsed = parseMdx(text);
  if (!parsed) return { touched: false, coverAdded: false, tldrAdded: false, rel };

  let { frontmatter, body } = parsed;
  let coverAdded = false;
  let tldrAdded = false;

  // ── cover ────────────────────────────────────────────────────
  if (!TLDR_ONLY && (FORCE || !hasField(frontmatter, "cover"))) {
    const coverPath = await pickCoverFromLibrary(`${kind}-${date}`);
    if (coverPath) {
      frontmatter = injectCover(frontmatter, coverPath);
      coverAdded = true;
    }
  }

  // ── TL;DR ────────────────────────────────────────────────────
  if (!COVER_ONLY && (FORCE || !body.includes(TLDR_MARKER))) {
    const titles = extractTitles(body);
    if (titles.length > 0) {
      const titleBrief = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
      const tldr = await digestTLDR(kind, titleBrief);
      if (tldr) {
        body = injectTLDR(body, renderTLDRBlock(tldr));
        tldrAdded = true;
      }
    }
  }

  if (coverAdded || tldrAdded) {
    const next = `---\n${frontmatter}\n---\n${body}`;
    await fs.writeFile(filePath, next, "utf-8");
    return { touched: true, coverAdded, tldrAdded, rel };
  }
  return { touched: false, coverAdded: false, tldrAdded: false, rel };
}

async function main() {
  const apiKey = process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY;
  if (!COVER_ONLY && !apiKey) {
    console.error("[backfill] 缺 DOUBAO_API_KEY。如果只想补 cover：加 --cover-only");
    process.exit(1);
  }

  const targets: Array<{ filePath: string; date: string; kind: "ai" | "invest" }> = [];
  for (const kind of (KIND_FILTER ? [KIND_FILTER] : ["ai", "invest"] as const)) {
    const dir = path.join(ROOT, "src", "content", kind);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      const m = f.match(/^digest-(\d{4}-\d{2}-\d{2})\.zh\.mdx$/);
      if (!m) continue;
      targets.push({ filePath: path.join(dir, f), date: m[1], kind });
    }
  }
  // 倒序：新的先处理（先看到效果）
  targets.sort((a, b) => b.date.localeCompare(a.date));
  const sliced = Number.isFinite(LIMIT) ? targets.slice(0, LIMIT) : targets;

  console.log(`[backfill] 候选 ${targets.length} 篇 · 本次处理 ${sliced.length} 篇 · ${FORCE ? "FORCE" : "增量"}${TLDR_ONLY ? " · TLDR_ONLY" : ""}${COVER_ONLY ? " · COVER_ONLY" : ""}`);
  let cAdd = 0, tAdd = 0, skip = 0;
  for (let i = 0; i < sliced.length; i++) {
    const t = sliced[i];
    console.log(`  [${i + 1}/${sliced.length}] ${path.basename(t.filePath)}`);
    try {
      const r = await processOne(t.filePath, t.date, t.kind);
      if (r.touched) {
        if (r.coverAdded) cAdd++;
        if (r.tldrAdded) tAdd++;
        console.log(`    ✓ cover=${r.coverAdded} tldr=${r.tldrAdded}`);
      } else {
        skip++;
        console.log("    · 已就绪，跳过");
      }
    } catch (e: any) {
      console.warn(`    ✗ ${e.message?.slice(0, 200)}`);
    }
    // 限流 600ms（豆包 QPS）
    if (i < sliced.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
  console.log(`\n[backfill] cover 新增 ${cAdd} · TL;DR 新增 ${tAdd} · 跳过 ${skip}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
