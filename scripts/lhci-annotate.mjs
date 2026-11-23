#!/usr/bin/env node
/**
 * 把 Lighthouse CI 的断言失败写成 GitHub 注解（第 182 轮）
 *
 * 为什么要这个：`lighthouse-mobile.yml` 连续两次失败，而**失败原因只存在于需要登录才能读
 * 的 job 日志里**（第 181 轮在 a11y 上踩过同一个坑：CI 红了，公开的 Actions 页面只写
 * "Process completed with exit code 1"）。断言失败本来就是"哪条规则、哪一页、期望多少、
 * 实测多少"，正好能变成注解，让任何人不用登录就能看见。
 *
 * 用法：node scripts/lhci-annotate.mjs --file=.lighthouseci/assertion-results.json
 * 退出码恒 0：注解是"把结论说清楚"，不改变 CI 的成败（成败由 lhci 自己决定）。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** 纯逻辑：断言结果 → 失败清单 + 注解文本。 */
export function summarizeAssertions(results = []) {
  const failed = results.filter((row) => row && row.passed === false);
  const errors = failed.filter((row) => (row.level ?? "error") === "error");
  const warnings = failed.filter((row) => (row.level ?? "error") !== "error");
  /** 只保留"人看得懂"的三件事：哪条规则、哪一页、差多少。 */
  const describe = (row) => {
    // auditProperty 更具体（categories:accessibility），auditId 只到类目（categories）
    const rule = row.auditProperty ?? row.auditId ?? "unknown";
    const expected = row.operator ? `${row.operator} ${row.expected}` : String(row.expected ?? "");
    return {
      rule,
      url: row.url ?? "",
      text: `${rule}：期望 ${expected || "达标"}，实测 ${row.actual ?? "?"}`,
    };
  };
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    errors: errors.map(describe),
    warnings: warnings.map(describe),
  };
}

export function main(argv = process.argv.slice(2)) {
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const file = fileArg ? path.resolve(process.cwd(), fileArg.slice("--file=".length)) : ".lighthouseci/assertion-results.json";
  if (!existsSync(file)) {
    console.log(`::warning title=lighthouse-mobile::找不到断言结果（${path.basename(file)}），无法给出失败原因`);
    return 0;
  }
  let results;
  try {
    results = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.log("::warning title=lighthouse-mobile::断言结果不是合法 JSON");
    return 0;
  }
  const summary = summarizeAssertions(Array.isArray(results) ? results : []);
  console.log(`断言 ${summary.total} 条：通过 ${summary.passed}、失败 ${summary.failed}（error ${summary.errors.length} / warn ${summary.warnings.length}）`);

  for (const row of [...summary.errors, ...summary.warnings]) {
    const level = summary.errors.includes(row) ? "error" : "warning";
    const url = row.url ? `（${row.url.replace(/^https?:\/\/[^/]+/, "")}）` : "";
    console.log(`::${level} title=lighthouse-mobile ${row.rule}${url}::${row.text}`);
  }

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const lines = [
      "### Lighthouse Mobile 断言",
      "",
      `通过 ${summary.passed} / 失败 ${summary.failed}（共 ${summary.total}）`,
      "",
      ...summary.errors.map((row) => `- ❌ ${row.rule} ${row.text}`),
      ...summary.warnings.map((row) => `- ⚠️ ${row.rule} ${row.text}`),
    ];
    try {
      appendFileSync(summaryFile, `${lines.join("\n")}\n`);
    } catch {
      /* 本地跑没有这个文件 */
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
