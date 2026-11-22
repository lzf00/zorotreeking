#!/usr/bin/env node
/**
 * 行情/宏观快照文件的年龄看门狗（第 117 轮）。
 *
 * 起因：`us-market-latest.json` 里的 BLS 宏观块停在 2026-08-11，**101 天**没人发现 ——
 * 因为"数据旧"不是错误：构建成功、门禁全绿、页面照常打开，只是数字是三个月前的。
 * 这和内容停更是同一类静默故障，所以也给它一个可断言的阈值。
 *
 * 判据只看文件自己的时间字段（不联网）：
 *   us-market-latest.json   → market.quote_ts / macro.fetched_at（秒）/ macro.consensus.updated_at（ISO）
 *   wind-market-latest.json → asOf（ISO）
 *   wind-hk-market-latest.json → asOf（ISO）
 *
 * 分级（第 159 轮）：`severity: "warn"` 的条目只打印、不失败。用于"确实旧、但修它要
 * 动上游数据源"的那种 —— 一致预期（Trading Economics）就是：它停在 2026-08-07，
 * 页面却和 BLS 实际值并排展示。让它在报告里一直可见，但不把每周巡检变成恒红。
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

/** 只有日期、没有时刻的字段（如 target_date: "2026-11-20"）按北京时间零点解释。 */
export function beijingDateMs(date) {
  if (!date) return Number.NaN;
  return Date.parse(`${date}T00:00:00+08:00`);
}

/**
 * 要盯的快照：文件名 + 怎么从里面取出时间（返回毫秒）+ 可选的自定义阈值。
 * maxAgeDays 单独给是因为"每日"和"每交易日"的合理间隔不同：ETF 分析只在交易日跑，
 * 周末/假期断两三天是正常的，不能拿 7 天以外的统一阈值去误报。
 */
export const SNAPSHOTS = [
  { file: "wind-market-latest.json", label: "A 股快照", at: (d) => Date.parse(d?.asOf ?? "") },
  { file: "wind-hk-market-latest.json", label: "港股快照", at: (d) => Date.parse(d?.asOf ?? "") },
  { file: "us-market-latest.json", label: "美股行情兜底快照", at: (d) => (d?.market?.quote_ts ?? NaN) * 1000 },
  { file: "us-market-latest.json", label: "美国宏观（BLS）", at: (d) => (d?.macro?.fetched_at ?? NaN) * 1000 },
  {
    file: "us-market-latest.json",
    label: "美国宏观一致预期",
    at: (d) => Date.parse(d?.macro?.consensus?.updated_at ?? ""),
    maxAgeDays: 60,
    severity: "warn",
  },
  {
    file: "etf-three-factor-latest.json",
    label: "ETF 三因子分析",
    at: (d) => beijingDateMs(d?.target_date),
    maxAgeDays: 5,
  },
];

/** 纯函数：把「文件内容 + 现在」变成一行行结论。 */
export function ageRows(snapshots, { now = Date.now(), maxAgeDays = 7 } = {}) {
  return snapshots.map(({ file, label, at, maxAgeDays: ownLimit, severity }) => {
    // at 既可以是 (file) => ms 的函数（真实用法，要读文件），也可以直接给毫秒数（测试里更省事）
    const ms = typeof at === "function" ? at(file) : at;
    const ageDays = Number.isNaN(ms) ? null : Math.max(0, Math.floor((now - ms) / (DAY * 1000)));
    const limit = ownLimit ?? maxAgeDays;
    return {
      file,
      label,
      ageDays,
      maxAgeDays: limit,
      stale: ageDays === null || ageDays > limit,
      severity: severity ?? "fail",
    };
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
    withAt.push({
      file: snap.file,
      label: snap.label,
      maxAgeDays: snap.maxAgeDays,
      severity: snap.severity,
      at: () => snap.at(cache.get(snap.file)),
    });
  }
  return withAt;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const maxAgeArg = args.find((a) => a.startsWith("--max-age="));
  const maxAgeDays = maxAgeArg ? Number(maxAgeArg.slice("--max-age=".length)) : 7;

  const rows = ageRows(await load(), { maxAgeDays });
  const stale = rows.filter((row) => row.stale && row.severity !== "warn");
  const warn = rows.filter((row) => row.stale && row.severity === "warn");

  if (json) {
    console.log(JSON.stringify({ maxAgeDays, rows, stale }, null, 2));
  } else {
    console.log(`行情快照年龄（阈值 ${maxAgeDays} 天）\n`);
    console.log("| 快照 | 距今 | 结论 |");
    console.log("| --- | --- | --- |");
    for (const row of rows) {
      const age = row.ageDays === null ? "时间未知" : `${row.ageDays} 天`;
      const mark = !row.stale ? "✅" : row.severity === "warn" ? "⚠️ 偏旧（不挡发布）" : "❌ 太旧";
      console.log(`| ${row.label} | ${age} | ${mark} |`);
    }
  }
  if (warn.length) {
    console.log(
      `\n⚠️  ${warn.map((row) => `${row.label}（${row.ageDays === null ? "时间未知" : `${row.ageDays} 天`}）`).join("；")} —— 不挡发布，但要有人跟进`,
    );
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
