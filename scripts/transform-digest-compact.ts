/**
 * 一次性脚本：把 src/content/{ai,invest}/digest-*.mdx 从旧的"4 行 meta + AI 摘要标签 + --- 分隔线"
 * 转换成新的"📄 一行 meta + 直接摘要"紧凑格式。
 *
 * 用法：
 *   npx tsx scripts/transform-digest-compact.ts            # 真改文件
 *   npx tsx scripts/transform-digest-compact.ts --dry-run  # 只打印 diff 不写
 *
 * 转换规则对应 digest-fetch.ts 当前模板。跑一次后即可删本脚本。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");

interface Stats {
  file: string;
  before: number;
  after: number;
  entries: number;
}

function transformAI(src: string): { out: string; entries: number } {
  let entries = 0;
  // 单条 entry 旧模板：
  //   **作者**：X, Y, Z…  \n
  //   **HF 投票**：N  \n
  //   **Hugging Face**：[url](url)\n
  //   \n
  //   **AI 摘要**：\n
  //   \n
  //   正文\n
  const out = src.replace(
    /(?:\*\*作者\*\*：([^\n]+)\s{0,2}\n)?(?:\*\*HF 投票\*\*：(\d+)\s{0,2}\n)?(?:\*\*Hugging Face\*\*：\[([^\]]+)\]\(([^)]+)\)\n)?\n?\*\*AI 摘要\*\*：\n\n/g,
    (_match, authorRaw, votes, _hfText, hfUrl) => {
      entries++;
      const parts: string[] = [];
      if (votes) parts.push(`HF ★ ${votes}`);
      if (authorRaw) {
        // 老格式可能已是 "X, Y, Z, A, B…"（最多 5 个），收紧到前 3
        const authors = authorRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
        const hasMore = authorRaw.includes("…") || authors.length > 3;
        const head = authors.slice(0, 3).join(", ");
        parts.push(head + (hasMore ? "…" : ""));
      }
      if (hfUrl) parts.push(`[HF 镜像](${hfUrl})`);
      if (parts.length === 0) return "";
      return `*📄 ${parts.join(" · ")}*\n\n`;
    },
  );
  // 去掉 entry 之间的 `\n---\n` 分隔线（FeedbackButtons 后面那个）
  const out2 = out.replace(/\n<FeedbackButtons ([^>]+)\/>\n\n---\n\n/g, "\n<FeedbackButtons $1/>\n\n");
  return { out: out2, entries };
}

function transformInvest(src: string): { out: string; entries: number } {
  let entries = 0;
  // 单条 invest entry 旧模板：
  //   **时间**：2026-05-29 12:34:56  \n
  //   **涉及**：A、B、C  \n
  //   \n
  //   正文
  const out = src.replace(
    /\*\*时间\*\*：([^\n]+?)\s{0,2}\n(?:\*\*涉及\*\*：([^\n]+?)\s{0,2}\n)?\n/g,
    (_match, time, stocks) => {
      entries++;
      const parts: string[] = [`🕐 ${time.trim()}`];
      if (stocks) parts.push(`涉及：${stocks.trim()}`);
      return `*${parts.join(" · ")}*\n\n`;
    },
  );
  // 去 `\n---\n` 分隔线（FeedbackButtons 后面那个）
  const out2 = out.replace(/\n<FeedbackButtons ([^>]+)\/>\n\n---\n\n/g, "\n<FeedbackButtons $1/>\n\n");
  return { out: out2, entries };
}

async function processDir(subdir: "ai" | "invest"): Promise<Stats[]> {
  const dir = path.join(PROJECT_ROOT, "src", "content", subdir);
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith("digest-") && f.endsWith(".mdx"));
  const results: Stats[] = [];
  for (const f of files.sort()) {
    const full = path.join(dir, f);
    const raw = await fs.readFile(full, "utf-8");
    const { out, entries } = subdir === "ai" ? transformAI(raw) : transformInvest(raw);
    if (out !== raw && entries > 0) {
      results.push({ file: `${subdir}/${f}`, before: raw.length, after: out.length, entries });
      if (!DRY) await fs.writeFile(full, out, "utf-8");
    } else if (entries === 0 && raw.includes("**AI 摘要**")) {
      console.warn(`⚠️  ${f} 含 "**AI 摘要**" 但未匹配到 entry，跳过——检查正则`);
    }
  }
  return results;
}

async function main() {
  console.log(`[transform-digest-compact] ${DRY ? "DRY RUN（不会写文件）" : "正式跑"}\n`);

  const aiStats = await processDir("ai");
  const investStats = await processDir("invest");

  console.log("\n── AI digest ──");
  for (const s of aiStats) {
    const saved = s.before - s.after;
    const pct = Math.round((saved / s.before) * 100);
    console.log(`  ${s.file}: ${s.entries} entries · ${s.before} → ${s.after} bytes (-${saved}, -${pct}%)`);
  }
  console.log("\n── Invest digest ──");
  for (const s of investStats) {
    const saved = s.before - s.after;
    const pct = Math.round((saved / s.before) * 100);
    console.log(`  ${s.file}: ${s.entries} entries · ${s.before} → ${s.after} bytes (-${saved}, -${pct}%)`);
  }

  const allFiles = aiStats.length + investStats.length;
  const allBefore = [...aiStats, ...investStats].reduce((a, s) => a + s.before, 0);
  const allAfter = [...aiStats, ...investStats].reduce((a, s) => a + s.after, 0);
  console.log(`\n[总计] ${allFiles} 文件 · ${allBefore} → ${allAfter} bytes (-${Math.round(((allBefore - allAfter) / allBefore) * 100)}%)`);
  if (DRY) console.log("\n（dry-run；去掉 --dry-run 实际写入）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
