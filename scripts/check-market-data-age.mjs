#!/usr/bin/env node
/**
 * 行情/宏观快照文件的年龄看门狗（第 117 轮）。
 *
 * 起因：`us-market-latest.json` 里的 BLS 宏观块停在 2026-08-11，**101 天**没人发现 ——
 * 因为"数据旧"不是错误：构建成功、门禁全绿、页面照常打开，只是数字是三个月前的。
 * 这和内容停更是同一类静默故障，所以也给它一个可断言的阈值。
 *
 * 判据只看文件自己的时间字段（不联网）：
 *   us-market-latest.json   → market.quote_ts / macro.fetched_at（秒）
 *   wind-market-latest.json → asOf（ISO）
 *   wind-hk-market-latest.json → asOf（ISO）
 *
 * 用法：
 *   node scripts/check-market-data-age.mjs               # 默认阈值 7 天
 *   node scripts/check-market-data-age.mjs --max-age=3
 *   node scripts/check-market-data-age.mjs --json
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "data");
const DAY = 86_400;

/** 要盯的快照：文件名 + 怎么从里面取出时间（返回毫秒）。 */
export const SNAPSHOTS = [
  { file: "wind-market-latest.json", label: "A 股快照", at: (d) => Date.parse(d?.asOf ?? "") },
  { file: "wind-hk-market-latest.json", label: "港股快照", at: (d) => Date.parse(d?.asOf ?? "") },
  { file: "us-market-latest.json", label: "美股行情兜底快照", at: (d) => (d?.market?.quote_ts ?? NaN) * 1000 },
  { file: "us-market-latest.json", label: "美国宏观（BLS）", at: (d) => (d?.macro?.fetched_at ?? NaN) * 1000 },
];

/** 纯函数：把「文件内容 + 现在」变成一行行结论。 */
export function ageRows(snapshots, { now = Date.now(), maxAgeDays = 7 } = {}) {
  return snapshots.map(({ file, label, at }) => {
    const ms = at(file);
    const ageDays = Number.isNaN(ms) ? null : Math.max(0, Math.floor((now - ms) / (DAY * 1000)));
    return { file, label, ageDays, stale: ageDays === null || ageDays > maxAgeDays };
  });
}

async function load() {
  const cache = new Map();
  const withAt = [];
  for (const snap of SNAPSHOTS) {
    if (!cache.has(snap.file)) {
      try {
        cache.set(snap.file, JSON.parse(await readFile(path.join(DATA, snap.file), "utf8")));
      } catch {
        cache.set(snap.file, null);
      }
    }
    withAt.push({ file: snap.file, label: snap.label, at: () => snap.at(cache.get(snap.file)) });
  }
  return withAt;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const maxAgeArg = args.find((a) => a.startsWith("--max-age="));
  const maxAgeDays = maxAgeArg ? Number(maxAgeArg.slice("--max-age=".length)) : 7;

  const rows = ageRows(await load(), { maxAgeDays });
  const stale = rows.filter((row) => row.stale);

  if (json) {
    console.log(JSON.stringify({ maxAgeDays, rows, stale }, null, 2));
  } else {
    console.log(`行情快照年龄（阈值 ${maxAgeDays} 天）\n`);
    console.log("| 快照 | 距今 | 结论 |");
    console.log("| --- | --- | --- |");
    for (const row of rows) {
      const age = row.ageDays === null ? "时间未知" : `${row.ageDays} 天`;
      console.log(`| ${row.label} | ${age} | ${row.stale ? "❌ 太旧" : "✅"} |`);
    }
  }
  if (stale.length) {
    console.error(
      `::error title=行情快照过旧::${stale.map((row) => `${row.label}（${row.ageDays === null ? "时间未知" : `${row.ageDays} 天`}）`).join("；")}`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
