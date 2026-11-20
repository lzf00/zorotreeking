#!/usr/bin/env node
/**
 * 内容新鲜度看门狗：**没有产出**也要能被发现。
 *
 * 背景（第 78 轮）：AI 日报从 2026-11-18 之后就再没出现，而投资复盘照常更新 ——
 * 站点照样构建、门禁全绿、巡检 0 失败，因为「少一篇文章」不是错误，只是内容不再更新。
 * 这种静默停更像水管漏水：没人看就永远不会修。定时任务里缺一个「今天到底产出了没」的
 * 断言，所以补这个脚本。
 *
 * 它只读 `src/content/` 的文件名（`digest-YYYY-MM-DD.*` / `market-recap-YYYY-MM-DD.*`），
 * 不读文件内容、不联网，所以可以在任何地方跑。
 *
 * 用法：
 *   node scripts/check-freshness.mjs                     # 表格 + 退出码
 *   node scripts/check-freshness.mjs --max-age=2         # 允许落后几天（默认 2）
 *   node scripts/check-freshness.mjs --require-today     # 今天必须有产出（日报流水线收尾用）
 *   node scripts/check-freshness.mjs --json              # 机器可读
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "src", "content");

/** 每条内容流水线：名字、目录、文件名里的日期格式、期望节奏、怎么算「今天该有」。 */
export const STREAMS = [
  {
    id: "ai-digest",
    label: "AI 日报",
    dir: "ai",
    pattern: /^digest-(\d{4}-\d{2}-\d{2})\.(?:zh|en)\.mdx$/,
    cadenceDays: 1,
  },
  {
    id: "invest-recap",
    label: "投资复盘",
    dir: "invest",
    pattern: /^market-recap-(\d{4}-\d{2}-\d{2})\.(?:zh|en)\.mdx$/,
    cadenceDays: 1,
  },
];

/** 北京时间今天（UTC+8，无夏令时）。 */
export function beijingToday(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const dayNumber = (isoDate) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

/**
 * 纯函数：把「文件名列表」变成新鲜度结论。可单测，不碰磁盘。
 *
 * @param {Record<string, string[]>} filesByStream 流 id → 文件名数组
 * @param {{ today?: string, maxAgeDays?: number, requireToday?: boolean }} options
 */
export function summarizeFreshness(filesByStream, { today = beijingToday(), maxAgeDays = 2, requireToday = false } = {}) {
  const rows = [];
  for (const stream of STREAMS) {
    const files = filesByStream[stream.id] ?? [];
    let newest = null;
    for (const name of files) {
      const date = stream.pattern.exec(name)?.[1];
      if (!date) continue;
      if (!newest || date > newest) newest = date;
    }
    const age = newest ? daysBetween(newest, today) : null;
    let level = "ok";
    let reason = "";
    if (!newest) {
      level = "fail";
      reason = "一篇都没有";
    } else if (requireToday && newest !== today) {
      level = "fail";
      reason = `今天（${today}）没有产出，最新是 ${newest}`;
    } else if (age > maxAgeDays) {
      level = "fail";
      reason = `已经 ${age} 天没有更新（最新 ${newest}，阈值 ${maxAgeDays} 天）`;
    } else if (age > stream.cadenceDays) {
      level = "warn";
      reason = `落后 ${age} 天（节奏 ${stream.cadenceDays} 天/篇）`;
    }
    rows.push({ ...stream, newest, age, level, reason, count: files.filter((name) => stream.pattern.test(name)).length });
  }
  const failing = rows.filter((row) => row.level === "fail");
  return { today, rows, failing, ok: failing.length === 0 };
}

export function formatFreshness({ today, rows, ok }) {
  const lines = [`内容新鲜度（北京时间 ${today}）`, "", "| 流水线 | 最新一篇 | 落后 | 篇数 | 结论 |", "| --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    const icon = row.level === "ok" ? "✅" : row.level === "warn" ? "⚠️" : "❌";
    lines.push(
      `| ${row.label} | ${row.newest ?? "—"} | ${row.age === null ? "—" : `${row.age} 天`} | ${row.count} | ${icon}${row.reason ? ` ${row.reason}` : ""} |`,
    );
  }
  lines.push("");
  lines.push(ok ? "内容流水线正常" : "有流水线已经停更，请查对应 workflow 的运行日志");
  return lines.join("\n");
}

async function loadFiles() {
  const filesByStream = {};
  for (const stream of STREAMS) {
    try {
      filesByStream[stream.id] = await readdir(path.join(CONTENT, stream.dir));
    } catch {
      filesByStream[stream.id] = [];
    }
  }
  return filesByStream;
}

async function main() {
  const json = process.argv.includes("--json");
  const requireToday = process.argv.includes("--require-today");
  const maxAgeArg = process.argv.find((value) => value.startsWith("--max-age="));
  const maxAgeDays = maxAgeArg ? Number(maxAgeArg.slice("--max-age=".length)) : 2;

  const result = summarizeFreshness(await loadFiles(), { requireToday, maxAgeDays });
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${formatFreshness(result)}\n`);

  if (!result.ok) {
    process.stderr.write(`::error title=内容流水线停更::${result.failing.map((row) => `${row.label}：${row.reason}`).join("；")}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
