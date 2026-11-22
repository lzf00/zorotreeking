#!/usr/bin/env node
/**
 * workflow 触发方式体检（第 162 轮）。
 *
 * 起因：这个仓库的 `schedule` 实测延迟 5–7.5 小时，还出现过整天不触发
 * （日报 2026-11-19 起停更三天、第 161 轮「本周看点」缺一期，都是这么来的）。
 * 于是"只有 cron 的 workflow"实际上等于**永远不会跑**：a11y / site-audit /
 * deadlink / weekly-roundup / lighthouse-mobile 全部踩过。
 *
 * 判据（静态读 yml，不联网）：
 *   - 没 schedule            → 事件驱动，OK
 *   - 有 schedule 且有 workflow_run / push → cron 只是兜底，OK
 *   - 只有 schedule          → 必须在 scripts/workflow-coverage.json 里声明覆盖方式
 *
 * 用法：
 *   node scripts/check-workflows.mjs
 *   node scripts/check-workflows.mjs --json
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".github", "workflows");
const COVERAGE = path.join(ROOT, "scripts", "workflow-coverage.json");

/** GitHub 的 `on:` 在 YAML 1.1 里可能被解析成 `true`，两种都认。 */
export function triggersOf(workflow) {
  const raw = workflow?.on ?? workflow?.true ?? {};
  if (typeof raw === "string") return [raw];
  return Object.keys(raw ?? {}).filter((k) => k !== "workflow_dispatch");
}

/**
 * 纯判定，便于单测。
 * @param {{file: string, triggers: string[]}[]} workflows
 * @param {Record<string, string>} coverage
 */
export function auditWorkflows(workflows, coverage) {
  const rows = [];
  const problems = [];
  const declared = new Set(Object.keys(coverage).filter((k) => !k.startsWith("_")));
  for (const wf of workflows) {
    const scheduled = wf.triggers.includes("schedule");
    const eventDriven = wf.triggers.some((t) => t === "workflow_run" || t === "push");
    const isCovered = declared.has(wf.file);
    if (!scheduled) {
      rows.push({ ...wf, verdict: "ok", why: "事件驱动（没有 schedule）" });
    } else if (eventDriven) {
      rows.push({ ...wf, verdict: "ok", why: "cron 只是兜底，主通道是 workflow_run/push" });
    } else if (isCovered && coverage[wf.file].startsWith("accepted:")) {
      rows.push({ ...wf, verdict: "accepted", why: coverage[wf.file].slice("accepted:".length).trim() });
    } else if (isCovered) {
      rows.push({ ...wf, verdict: "ok", why: coverage[wf.file] });
    } else {
      rows.push({ ...wf, verdict: "problem", why: "只有 cron —— 在这个仓库等于不会跑" });
      problems.push(`${wf.file} 只有 cron 触发：接到部署流程/每周巡检里，或写进 workflow-coverage.json 说明`);
    }
  }
  const seen = new Set(workflows.map((w) => w.file));
  for (const name of declared) {
    if (!seen.has(name)) problems.push(`workflow-coverage.json 里的 ${name} 已经不存在了，删掉这条`);
  }
  return { rows, problems };
}

export function loadWorkflows(dir = DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.sort().map((file) => {
    const parsed = parse(readFileSync(path.join(dir, file), "utf8"));
    return { file, triggers: triggersOf(parsed) };
  });
}

function main() {
  const json = process.argv.includes("--json");
  const coverage = JSON.parse(readFileSync(COVERAGE, "utf8"));
  const { rows, problems } = auditWorkflows(loadWorkflows(), coverage);
  if (json) {
    console.log(JSON.stringify({ rows, problems }, null, 2));
  } else {
    console.log("| workflow | 触发 | 结论 | 依据 |");
    console.log("| --- | --- | --- | --- |");
    for (const row of rows) {
      const mark = row.verdict === "ok" ? "✅" : row.verdict === "accepted" ? "⚠️ 已知缺口" : "❌";
      console.log(`| ${row.file} | ${row.triggers.join(", ") || "—"} | ${mark} | ${row.why} |`);
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`::error title=workflow 触发方式::${p}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
