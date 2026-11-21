/**
 * 重铺 digest 封面（第 111 轮）。
 *
 * 背景：归档页 680 篇 digest 只用了 13 张不同封面，其中 **630 篇锁死在 2 张图**上。
 * 原因是封面在生成时按"当下相册池"取，池子从 2 张长到 40 张，早期生成的永远不会变。
 * 结果投资/AI 日报归档页翻两屏就是同一张图反复出现。
 *
 * 这个脚本按新的等距规则（`pickIndex`）重算全部 digest 的 cover：
 *  - 只改 frontmatter 的 `cover:` 一行，其它内容一个字不动；
 *  - 没写 cover 的补上；已有的不一致才改（幂等，第二次跑 0 处改动）；
 *  - `--dry-run` 只统计不落盘。
 *
 * 用法：
 *   npx tsx scripts/backfill-digest-covers.ts --dry-run
 *   npx tsx scripts/backfill-digest-covers.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pickCoverFromLibrary } from "./lib/cover-picker.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STREAMS = ["ai", "invest"] as const;

/** 从 frontmatter 抓日期（优先 `date:`，回退文件名里的 YYYY-MM-DD）。 */
export function digestDate(frontmatter: string, filename: string): string | null {
  const fromFm = /^date:\s*"?(\d{4}-\d{2}-\d{2})"?/m.exec(frontmatter);
  if (fromFm) return fromFm[1];
  const fromName = /(\d{4}-\d{2}-\d{2})/.exec(filename);
  return fromName ? fromName[1] : null;
}

/** 把 frontmatter 里的 cover 换成 target；没有就插在 date 行后面。返回新文本或 null（无需改）。 */
export function withCover(source: string, target: string): string | null {
  const fmEnd = source.indexOf("\n---", 4);
  const head = source.slice(0, fmEnd);
  const rest = source.slice(fmEnd);
  const current = /^cover:\s*"?([^"\n]*)"?\s*$/m.exec(head);
  if (current && current[1] === target) return null;
  if (current) {
    return head.replace(/^cover:\s*"?([^"\n]*)"?\s*$/m, `cover: "${target}"`) + rest;
  }
  const withCoverLine = head.replace(/^(date:.*)$/m, `$1\ncover: "${target}"`);
  if (!withCoverLine.includes("cover:")) return null; // 没有 date 行，不敢乱插
  return withCoverLine + rest;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const stats = { scanned: 0, missingDate: 0, unchanged: 0, updated: 0, skippedNoPoolEntry: 0 };
  const before = new Map<string, number>();
  const after = new Map<string, number>();

  for (const stream of STREAMS) {
    const dir = path.join(ROOT, "src", "content", stream);
    // zh / en 两版共用同一张封面（同一个 translationKey），否则中英页面同一篇文章封面不一致
    const files = (await fs.readdir(dir)).filter((f) => /^digest-\d{4}-\d{2}-\d{2}\.(zh|en)\.mdx$/.test(f)).sort();
    for (const file of files) {
      stats.scanned++;
      const full = path.join(dir, file);
      const source = await fs.readFile(full, "utf8");
      const fm = source.slice(0, source.indexOf("\n---", 4));
      const date = digestDate(fm, file);
      const oldCover = /^cover:\s*"?([^"\n]*)"?\s*$/m.exec(fm)?.[1] ?? null;
      if (oldCover) before.set(oldCover, (before.get(oldCover) ?? 0) + 1);
      if (!date) {
        stats.missingDate++;
        continue;
      }
      const target = await pickCoverFromLibrary(date);
      if (!target) {
        stats.skippedNoPoolEntry++;
        continue;
      }
      after.set(target, (after.get(target) ?? 0) + 1);
      const next = withCover(source, target);
      if (!next) {
        stats.unchanged++;
        continue;
      }
      stats.updated++;
      if (!dryRun) await fs.writeFile(full, next, "utf8");
    }
  }

  const summarise = (m: Map<string, number>) => {
    const counts = [...m.values()].sort((a, b) => b - a);
    return { distinct: m.size, max: counts[0] ?? 0, p95: counts[Math.floor(counts.length * 0.05)] ?? 0 };
  };
  const b = summarise(before);
  const a = summarise(after);
  console.log(`\n[backfill] ${dryRun ? "（dry-run，未写盘）" : ""}`);
  console.log(`  扫描 ${stats.scanned} 篇 | 更新 ${stats.updated} | 未变 ${stats.unchanged} | 缺日期 ${stats.missingDate} | 无封面 ${stats.skippedNoPoolEntry}`);
  console.log(`  改前：${b.distinct} 张不同封面，单张最多被用 ${b.max} 次`);
  console.log(`  改后：${a.distinct} 张不同封面，单张最多被用 ${a.max} 次`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
