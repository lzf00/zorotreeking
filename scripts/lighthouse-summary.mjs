#!/usr/bin/env node
/**
 * 把 `.lighthouseci/` 里的 LHCI 报告汇总成一张 markdown 表。
 *
 * 为什么要这个脚本：
 * - LHCI 自己的输出是逐 URL 的断言日志，散在几十行里，CI 日志被截断时只能看到尾部；
 * - GitHub 的 artifacts API 在我们这边经常取不到（过期或未上传成功），
 *   导致"这一轮性能到底多少分"只能靠猜。
 *
 * 所以跑完 LHCI 后生成一张表，同时写进：
 * 1) step summary（Actions 页面直接可看）
 * 2) 标准输出（即使日志被截断，尾部这段也在）
 * 3) 交给 upload-artifact 一起上传
 *
 * 用法：node scripts/lighthouse-summary.mjs [--dir .lighthouseci] [--summary-out file]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/** 取中位数（偶数个取中间两个的平均） */
export function median(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return NaN;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

const METRICS = [
  ["lcp", "largest-contentful-paint", 1000, "s"],
  ["tbt", "total-blocking-time", 1, "ms"],
  ["cls", "cumulative-layout-shift", 1, ""],
  ["si", "speed-index", 1000, "s"],
];

/** 从一份 LHR 提取报告需要的字段 */
export function pickRun(lhr) {
  const cat = lhr?.categories ?? {};
  const audits = lhr?.audits ?? {};
  const run = {
    url: lhr?.finalUrl ?? lhr?.requestedUrl ?? "",
    perf: cat.performance?.score,
    a11y: cat.accessibility?.score,
    bp: cat["best-practices"]?.score,
    seo: cat.seo?.score,
  };
  for (const [key, auditId] of METRICS) {
    const value = audits[auditId]?.numericValue;
    run[key] = typeof value === "number" ? value : undefined;
  }
  return run;
}

const fmtScore = (score) => (typeof score === "number" ? score.toFixed(2) : "—");

/**
 * 把多份 LHR 汇总成按 perf 升序排列的行（最差在前，方便一眼看到退步）。
 * @param {Array<object>} lhrs Lighthouse 结果对象数组（同一 URL 可有多份）
 */
export function summarize(lhrs) {
  const byUrl = new Map();
  for (const lhr of lhrs) {
    const run = pickRun(lhr);
    if (!run.url) continue;
    if (!byUrl.has(run.url)) byUrl.set(run.url, []);
    byUrl.get(run.url).push(run);
  }

  const rows = [];
  for (const [url, runs] of byUrl) {
    const row = {
      url,
      runs: runs.length,
      perf: median(runs.map((r) => r.perf)),
      a11y: median(runs.map((r) => r.a11y)),
      bp: median(runs.map((r) => r.bp)),
      seo: median(runs.map((r) => r.seo)),
      lcp: median(runs.map((r) => r.lcp)),
      tbt: median(runs.map((r) => r.tbt)),
      cls: median(runs.map((r) => r.cls)),
      si: median(runs.map((r) => r.si)),
    };
    rows.push(row);
  }
  rows.sort((a, b) => (Number.isFinite(a.perf) ? a.perf : 2) - (Number.isFinite(b.perf) ? b.perf : 2));
  return rows;
}

const shortPath = (url) => {
  try {
    const { pathname } = new URL(url);
    return pathname === "/" ? "/" : pathname;
  } catch {
    return url;
  }
};

/** 渲染成 markdown 表格 */
export function renderTable(rows, { title = "Lighthouse 逐 URL 中位分数" } = {}) {
  const lines = [`### ${title}`, ""];
  if (rows.length === 0) {
    lines.push("_没有找到任何报告_");
    return lines.join("\n");
  }
  lines.push("| 页面 | perf | a11y | best-practices | seo | LCP | TBT | CLS | Speed Index | 次数 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| \`${shortPath(r.url)}\` | ${fmtScore(r.perf)} | ${fmtScore(r.a11y)} | ${fmtScore(r.bp)} | ${fmtScore(r.seo)} ` +
        `| ${Number.isFinite(r.lcp) ? (r.lcp / 1000).toFixed(2) + "s" : "—"} ` +
        `| ${Number.isFinite(r.tbt) ? Math.round(r.tbt) + "ms" : "—"} ` +
        `| ${Number.isFinite(r.cls) ? r.cls.toFixed(3) : "—"} ` +
        `| ${Number.isFinite(r.si) ? (r.si / 1000).toFixed(2) + "s" : "—"} | ${r.runs} |`,
    );
  }
  return lines.join("\n");
}

/** 读取 .lighthouseci 目录下的所有 lhr-*.json */
export function readLhrs(dir = ".lighthouseci") {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f)).sort();
  const lhrs = [];
  for (const file of files) {
    try {
      lhrs.push(JSON.parse(readFileSync(join(dir, file), "utf8")));
    } catch {
      // 单份报告坏掉不影响其他报告
    }
  }
  return lhrs;
}

function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--dir");
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : ".lighthouseci";

  const rows = summarize(readLhrs(dir));
  const table = renderTable(rows);

  console.log(table);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${table}\n\n`);
    console.log(`\n[perf-summary] 已写入 ${summaryPath}`);
  }

  const outIndex = args.indexOf("--summary-out");
  if (outIndex >= 0) {
    writeFileSync(args[outIndex + 1], `${table}\n`, "utf8");
    console.log(`[perf-summary] 已写入 ${args[outIndex + 1]}`);
  }

  // 报告缺失当成提示，不让这一步自己把 job 弄挂（LHCI 才是判定者）
  if (rows.length === 0) console.log("[perf-summary] 提示：没有解析到任何报告，检查 .lighthouseci/ 是否存在");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
