/**
 * 按死链巡查报告，把已经 404 的引用链接摘成纯文本。
 *
 * 为什么要这个脚本：
 * 日报里的「消息来源」指向东方财富 / 同花顺的当日快讯，这两家会删稿。
 * 周扫发现的死链绝大多数是这种，量很小（2026-11 那次 5200 条外链里 1 条），
 * 但处理起来要逐个文件去找、去改。这个脚本把"找 + 改"自动化，
 * 顺手也能把 `<a href="...">标题</a>` 还原成 `标题`，和之前手工清洗的结果一致。
 *
 * 边界：
 *   - 只处理报告里 status 为 4xx（且不是 401/403/405 这类"看不见"的状态）的链接
 *   - 只改 `src/content/**` 下的 mdx
 *   - 幂等：已经摘过的不会重复处理
 *
 * 用法：
 *   npx tsx scripts/deadlink-delink.ts --dry-run        # 只打印会改什么
 *   npx tsx scripts/deadlink-delink.ts                  # 落盘
 *   npx tsx scripts/deadlink-delink.ts --report=reports/deadlinks-2026-11-11.json
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "src", "content");
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const REPORT_ARG = (() => {
  const m = ARGS.find((a) => a.startsWith("--report="));
  return m ? m.slice("--report=".length) : null;
})();

type DeadEntry = { url: string; status?: number | null; fromFile?: string };

const UNKNOWN_STATUS = new Set([401, 403, 405, 407, 408, 429, 451, 999]);

async function latestReport(): Promise<string> {
  if (REPORT_ARG) return path.resolve(ROOT, REPORT_ARG);
  const dir = path.join(ROOT, "reports");
  const files = (await fs.readdir(dir).catch(() => [] as string[]))
    .filter((f) => /^deadlinks-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) throw new Error("reports/ 里没有 deadlinks-*.json，先跑 check-deadlinks");
  return path.join(dir, files[files.length - 1]!);
}

/**
 * 把 `[标题](url)` / `<a href="url" ...>标题</a>` / 裸 URL 里的链接摘掉，保留文字。
 * 裸 URL 直接删除（没有文字可留）。返回替换次数。
 */
export function delink(text: string, url: string): { text: string; count: number } {
  let count = 0;
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 1) markdown 链接：[文字](url) / [文字](url "title")
  text = text.replace(new RegExp(`\\[([^\\]]+)\\]\\(${escaped}(?:\\s+"[^"]*")?\\)`, "g"), (_m, label: string) => {
    count += 1;
    return label;
  });

  // 2) HTML 锚点：<a href="url" ...>文字</a>
  text = text.replace(
    new RegExp(`<a\\s+[^>]*href="${escaped}"[^>]*>([\\s\\S]*?)</a>`, "g"),
    (_m, label: string) => {
      count += 1;
      return label;
    },
  );

  // 3) 裸 URL：前面可能是空格、中文冒号、括号……只要不是字母数字就吃掉
  text = text.replace(new RegExp(`(^|[^\\w/])${escaped}(?=$|[^\\w/])`, "g"), (_m, prefix: string) => {
    count += 1;
    return prefix;
  });

  return { text, count };
}

async function main() {
  const reportPath = await latestReport();
  const report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
  const dead: DeadEntry[] = Array.isArray(report.deadList) ? report.deadList : [];
  const actionable = dead.filter((d) => {
    if (!d.url) return false;
    const st = d.status ?? null;
    if (st == null) return false;
    return st >= 400 && st < 500 && !UNKNOWN_STATUS.has(st);
  });
  console.log(`[delink] 报告：${path.relative(ROOT, reportPath)}`);
  console.log(`  死链 ${dead.length} 条，可摘（真 4xx）${actionable.length} 条`);
  if (!actionable.length) {
    console.log("[delink] 没有需要摘的链接");
    return;
  }

  // 按 URL 汇总：哪些文件里出现了（报告里的 fromFile 只是首次出现的位置，正文可能多处引用）
  const byUrl = new Map<string, Set<string>>();
  for (const d of actionable) {
    const set = byUrl.get(d.url) ?? new Set<string>();
    if (d.fromFile) set.add(d.fromFile);
    byUrl.set(d.url, set);
  }

  // 全量扫一遍内容目录，别只信报告里的 fromFile
  const files: string[] = [];
  for (const col of await fs.readdir(CONTENT_DIR)) {
    const dir = path.join(CONTENT_DIR, col);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    for (const f of await fs.readdir(dir)) {
      if (f.endsWith(".mdx")) files.push(path.join(dir, f));
    }
  }

  let changedFiles = 0;
  let changedLinks = 0;
  for (const abs of files) {
    const original = await fs.readFile(abs, "utf-8");
    let text = original;
    for (const [url, seenIn] of byUrl) {
      if (!text.includes(url)) continue;
      const res = delink(text, url);
      if (res.count > 0) {
        text = res.text;
        changedLinks += res.count;
        const rel = path.relative(ROOT, abs);
        const noted = seenIn.has(rel.replace(/^src\/content\//, "")) ? "" : "（报告外的引用）";
        console.log(`  ${DRY_RUN ? "[dry] " : ""}${rel}: ${url} ×${res.count}${noted}`);
      }
    }
    if (text !== original) {
      changedFiles += 1;
      if (!DRY_RUN) await fs.writeFile(abs, text, "utf-8");
    }
  }

  console.log();
  console.log(`${DRY_RUN ? "[dry-run] " : ""}摘掉 ${changedLinks} 处 / ${changedFiles} 个文件`);
  if (changedLinks === 0) {
    console.log("提示：报告可能已过期（内容早就清洗过），重跑一次周扫再试");
  }
}

// 只有直接执行时才跑 main（方便单测 import delink）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
