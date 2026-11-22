#!/usr/bin/env node
/**
 * workflow 触发方式体检（第 162 轮）。
 *
 * 起因：这个仓库的 `schedule` 实测延迟 5–7.5 小时，还出现过整天不触发
 * （日报 2026-11-19 起停更三天、第 161 轮「本周看点」缺一期，都是这么来的）。
 * 于是"只有 cron 的 workflow"实际上等于**永远不会跑**：a11y / site-audit /
 * deadlink / weekly-roundup / lighthouse-mobile 全部踩过。
 *
 * 第 177 轮补上第二类：**可复用工作流的权限**。
 * deploy.yml 的 `catch-up-digest` 任务声明了 `actions: write`（要 dispatch 部署），
 * 而调用它的 daily-digest / weekly-roundup / bulk-backfill 只给了 `contents` + `statuses`。
 * 被调用方声明的权限大于调用方时，GitHub **在启动阶段就失败**（conclusion=startup_failure、
 * 一个 step 日志都没有），于是 AI 日报从 2026-11-19 起静默停更四天，靠部署时的
 * catch-up 兜底才勉强有内容。这种事静态就能查。
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
/** 从 yml 里取出「这个 workflow 需要的权限」：workflow 级 + 每个 job 级的并集。 */
export function permissionsOf(workflow) {
  const collect = (perms) => {
    if (perms === "write-all") return ["*:write"];
    if (perms === "read-all") return ["*:read"];
    if (!perms || typeof perms !== "object") return [];
    return Object.entries(perms).map(([scope, level]) => `${scope}:${level}`);
  };
  const needed = new Set(collect(workflow?.permissions));
  for (const job of Object.values(workflow?.jobs ?? {})) {
    for (const perm of collect(job?.permissions)) needed.add(perm);
  }
  return needed;
}

/** 校验「可复用工作流」的权限图：被调用方需要的权限必须是调用方给得起的。 */
export function auditReusablePermissions(workflows) {
  const byFile = new Map(workflows.map((w) => [w.file, w]));
  const problems = [];
  const rows = [];
  for (const caller of workflows) {
    if (!caller.calls?.length) continue;
    const granted = permissionsOf(caller.raw);
    // 调用方没声明 permissions → 用仓库默认（宽松），这里不判它
    if (granted.size === 0) {
      rows.push({ caller: caller.file, callee: caller.calls.join(", "), verdict: "unknown", why: "调用方未声明 permissions（用仓库默认）" });
      continue;
    }
    for (const calleeFile of caller.calls) {
      const callee = byFile.get(calleeFile);
      if (!callee) {
        problems.push(`${caller.file} 调用了不存在的 ${calleeFile}`);
        continue;
      }
      const needed = permissionsOf(callee.raw);
      const missing = [...needed].filter((perm) => {
        if (perm.endsWith(":read")) return false; // read 总是给得起
        return !granted.has(perm) && !granted.has("*:write");
      });
      if (missing.length) {
        rows.push({ caller: caller.file, callee: calleeFile, verdict: "problem", why: `缺 ${missing.join(", ")}` });
        problems.push(
          `${caller.file} 调用 ${calleeFile}，但没给 ${missing.join(", ")} —— 被调用方声明了这些权限，` +
            `运行会在启动阶段就失败（startup_failure，没有任何 step 日志）`,
        );
      } else {
        rows.push({ caller: caller.file, callee: calleeFile, verdict: "ok", why: "权限够" });
      }
    }
  }
  return { rows, problems };
}

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
    const calls = [];
    for (const job of Object.values(parsed?.jobs ?? {})) {
      const uses = job?.uses;
      if (typeof uses === "string" && uses.startsWith("./.github/workflows/")) {
        calls.push(uses.replace("./.github/workflows/", ""));
      }
    }
    return { file, triggers: triggersOf(parsed), calls, raw: parsed };
  });
}

function main() {
  const json = process.argv.includes("--json");
  const coverage = JSON.parse(readFileSync(COVERAGE, "utf8"));
  const workflows = loadWorkflows();
  const triggerAudit = auditWorkflows(workflows, coverage);
  const permissionAudit = auditReusablePermissions(workflows);
  const rows = [...triggerAudit.rows];
  const problems = [...triggerAudit.problems, ...permissionAudit.problems];
  if (json) {
    console.log(JSON.stringify({ rows, problems }, null, 2));
  } else {
    console.log("| workflow | 触发 | 结论 | 依据 |");
    void 0;
    console.log("| --- | --- | --- | --- |");
    for (const row of rows) {
      const mark = row.verdict === "ok" ? "✅" : row.verdict === "accepted" ? "⚠️ 已知缺口" : "❌";
      console.log(`| ${row.file} | ${row.triggers.join(", ") || "—"} | ${mark} | ${row.why} |`);
    }
  }
  if (permissionAudit.rows.length && !json) {
    console.log("\n**可复用工作流的权限**\n");
    console.log("| 调用方 | 被调用 | 结论 | 依据 |");
    console.log("| --- | --- | --- | --- |");
    for (const row of permissionAudit.rows) {
      const mark = row.verdict === "ok" ? "✅" : row.verdict === "unknown" ? "⚠️" : "❌";
      console.log(`| ${row.caller} | ${row.callee} | ${mark} | ${row.why} |`);
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`::error title=workflow 配置::${p}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
