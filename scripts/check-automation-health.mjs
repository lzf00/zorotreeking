#!/usr/bin/env node
/**
 * 自动化体检：**还有哪些 workflow 真的在跑**（第 179 轮）。
 *
 * 由来：连续两轮的故障都不是"站点坏了"，而是"自动化悄悄死了"——
 *   第 177 轮：日报 cron 四天 `startup_failure`（可复用工作流权限）；
 *   第 178 轮：停更报警器自己红在第一步，后面的判定被 skip，警报一起吞掉。
 * 两次的共同点：**站点构建、门禁、巡检全绿，只有"产出/告警"没了**，人是靠抽查才发现的。
 *
 * 这个脚本换成反过来问：每个 workflow 上次成功是什么时候？跟它自己的 cron 频率比，是否已经逾期？
 * 判据（纯静态 + 一次只读 API）：
 *   - 只有 cron 的 workflow：最近一次成功超过「cron 周期 × 2 + 1 天」→ 逾期
 *   - 最近 3 次全是失败/取消 → 连续失败
 *   - 从来没跑过 → 从没跑过（对只有 cron 的尤其可疑）
 *   - 事件驱动（push / workflow_run）的 workflow 不判逾期，只报连续失败
 *
 * 身份：在 Actions 里用 `GITHUB_TOKEN`（5000 次/小时）；本地没 token 就走未登录
 * （60 次/小时，可能被限流 —— 限流不算"体检失败"，明确说出来即可）。
 *
 * 用法：
 *   node scripts/check-automation-health.mjs                 # 打印表格；有逾期/连续失败则 exit 1
 *   node scripts/check-automation-health.mjs --json          # 机器可读
 *   node scripts/check-automation-health.mjs --runs=runs.json  # 用离线快照（测试/没网时）
 *   node scripts/check-automation-health.mjs --max-age-days=14 # 自定义宽限
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");
const REPO = process.env.GITHUB_REPOSITORY ?? "lzf00/zorotreeking";
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";

const argv = process.argv.slice(2);
const valueOf = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const JSON_OUT = argv.includes("--json");

/** cron 频率 → 期望间隔天数。只认这个仓库实际用到的两种形态（每天 / 每周）。 */
export function cadenceDaysOf(cron) {
  const fields = String(cron).trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [, , dom, , dow] = fields;
  if (dow !== "*" && dom === "*") return 7; // 周几被限定 → 每周一次
  return 1; // 其余按每天算（保守：宁可多要求它跑）
}

/** 从 workflow yml 里读出「期望频率」：只有 cron 触发的才需要判逾期。 */
export function expectationOf(workflow) {
  const raw = workflow?.on ?? workflow?.true ?? {};
  const triggers = typeof raw === "string" ? [raw] : Object.keys(raw ?? {});
  const schedules = Array.isArray(raw?.schedule) ? raw.schedule : raw?.schedule ? [raw.schedule] : [];
  const crones = schedules.map((s) => s?.cron).filter(Boolean);
  const hasSchedule = triggers.includes("schedule") || crones.length > 0;
  const eventDriven = triggers.some((t) => t === "push" || t === "workflow_run");
  if (!hasSchedule) return { kind: "event", days: null };
  const days = crones.map(cadenceDaysOf).filter((d) => d != null);
  const cadence = days.length ? Math.min(...days) : 1;
  return { kind: eventDriven ? "mixed" : "cron", days: cadence };
}

const daysBetween = (a, b) => (b.getTime() - a.getTime()) / 86_400_000;

/**
 * 纯判定。
 * @param {{file: string, expectation: {kind: string, days: number|null}}[]} workflows
 * @param {Record<string, {created_at: string, conclusion: string|null, status?: string}[]>} runs
 * @param {Date} now
 * @param {{maxAgeDays?: number}} [opts]
 */
export function auditAutomation(workflows, runs, now = new Date(), opts = {}) {
  const maxAgeDays = opts.maxAgeDays ?? 0;
  /** 读不到运行记录的 workflow：不能当成"没跑过"，否则限流一次就全员报"从来没有运行记录"。 */
  const unfetched = new Set(opts.unfetched ?? []);
  const rows = [];
  const problems = [];
  const inconclusive = [];
  for (const wf of workflows) {
    if (unfetched.has(wf.file)) {
      rows.push({
        file: wf.file,
        kind: wf.expectation.kind,
        cadenceDays: wf.expectation.days,
        lastRun: null,
        lastConclusion: null,
        lastSuccess: null,
        ageDays: null,
        verdict: "unknown",
        why: "读不到运行记录（API 限流/网络），无法判断",
      });
      inconclusive.push(wf.file);
      continue;
    }
    const list = (runs[wf.file] ?? []).filter((r) => r.created_at).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const lastSuccess = list.find((r) => r.conclusion === "success") ?? null;
    const recent = list.slice(0, 3);
    const recentAllBad = recent.length >= 2 && recent.every((r) => r.conclusion === "failure" || r.conclusion === "startup_failure" || r.conclusion === "cancelled");
    const lastRun = list[0] ?? null;
    const ageDays = lastSuccess ? daysBetween(new Date(lastSuccess.created_at), now) : Infinity;
    const budget = wf.expectation.days != null ? wf.expectation.days * 2 + 1 + maxAgeDays : null;

    let verdict = "ok";
    let why = lastSuccess ? `最近成功 ${lastSuccess.created_at.slice(0, 10)}（${Math.floor(ageDays)} 天前）` : "没有成功记录";
    if (!list.length) {
      verdict = wf.expectation.kind === "event" ? "ok" : "problem";
      why = "从来没有运行记录";
      if (verdict === "problem") problems.push(`${wf.file} 从来没有运行过（只有 cron 的 workflow 从不运行 = 不存在）`);
    } else if (recentAllBad) {
      verdict = "problem";
      why = `最近 ${recent.length} 次全部失败：${recent.map((r) => r.conclusion).join(" / ")}`;
      problems.push(`${wf.file} 连续 ${recent.length} 次失败（${recent[0]?.conclusion}）`);
    } else if (budget != null && Number.isFinite(ageDays) && ageDays > budget) {
      verdict = "problem";
      why = `逾期：期望每 ${wf.expectation.days} 天一次，实际 ${Math.floor(ageDays)} 天没有成功`;
      problems.push(`${wf.file} 逾期 ${Math.floor(ageDays)} 天没有成功运行（期望每 ${wf.expectation.days} 天）`);
    } else if (!lastSuccess) {
      // 混合触发（cron + workflow_run）的，没有成功记录往往是**上游坏了**：
      // freshness-watch 挂在 Daily digest 的 workflow_run 上，日报不跑它也跑不了。
      verdict = wf.expectation.kind === "mixed" ? "warn" : "problem";
      why = `有 ${list.length} 次运行记录但一次都没成功（上游 workflow_run 没触发？）`;
      if (verdict === "problem") problems.push(`${wf.file} 跑了 ${list.length} 次但从未成功`);
    }
    rows.push({
      file: wf.file,
      kind: wf.expectation.kind,
      cadenceDays: wf.expectation.days,
      lastRun: lastRun?.created_at?.slice(0, 10) ?? null,
      lastConclusion: lastRun?.conclusion ?? null,
      lastSuccess: lastSuccess?.created_at?.slice(0, 10) ?? null,
      ageDays: Number.isFinite(ageDays) ? Math.floor(ageDays) : null,
      verdict,
      why,
    });
  }
  return { rows, problems, inconclusive };
}

/**
 * GitHub 解析不了的 workflow：注册名会变成文件路径（第 180 轮实测）。
 *
 * 这是唯一一个**由 GitHub 自己给出**的语法判定 —— 我们的 YAML 为了"合法"而合法，
 * 但 GitHub 的解析器更严（`if:` 少一个引号就整条 workflow 启动即失败）。
 * 判据很干脆：API 里 `name` 等于 `path`，说明 `name:` 从来没被读出来过。
 */
export function auditWorkflowRegistration(apiWorkflows) {
  const problems = [];
  for (const wf of apiWorkflows ?? []) {
    if (!wf?.path || !wf?.name) continue;
    if (wf.name === wf.path) {
      problems.push(`${wf.path} GitHub 解析不了（workflow 名字显示成文件路径）—— 语法错误，整条 workflow 一启动就失败`);
    }
  }
  return problems;
}

export function loadWorkflows(dir = WORKFLOW_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const parsed = parse(readFileSync(path.join(dir, file), "utf8"));
      return { file, expectation: expectationOf(parsed) };
    });
}

function fetchRuns(file) {
  const args = [
    "-sS",
    "-H",
    "Accept: application/vnd.github+json",
    ...(TOKEN ? ["-H", `Authorization: Bearer ${TOKEN}`] : []),
    `https://api.github.com/repos/${REPO}/actions/workflows/${file}/runs?per_page=10`,
  ];
  const out = execFileSync("curl", args, { encoding: "utf8" });
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed.workflow_runs)) {
    throw new Error(parsed.message ?? "API 返回里没有 workflow_runs");
  }
  return parsed.workflow_runs.map((r) => ({ created_at: r.created_at, conclusion: r.conclusion, status: r.status }));
}

/** 读 GitHub 侧登记的 workflow 列表（用来看哪些文件 GitHub 根本解析不了）。 */
function fetchWorkflowList() {
  const args = [
    "-sS",
    "-H",
    "Accept: application/vnd.github+json",
    ...(TOKEN ? ["-H", `Authorization: Bearer ${TOKEN}`] : []),
    `https://api.github.com/repos/${REPO}/actions/workflows?per_page=100`,
  ];
  const parsed = JSON.parse(execFileSync("curl", args, { encoding: "utf8" }));
  if (!Array.isArray(parsed.workflows)) throw new Error(parsed.message ?? "API 返回里没有 workflows");
  return parsed.workflows.map((w) => ({ name: w.name, path: w.path }));
}

function main() {
  const maxAgeDays = Number(valueOf("max-age-days") ?? 0);
  const offline = valueOf("runs");
  const workflows = loadWorkflows();
  let runs = {};
  const unfetched = new Set();
  /** GitHub 自己说"这个文件我解析不了"的 workflow（名字退化成路径）。 */
  const registrationProblems = [];
  if (!offline) {
    try {
      for (const problem of auditWorkflowRegistration(fetchWorkflowList())) registrationProblems.push(problem);
    } catch (error) {
      console.error(`::warning title=自动化体检::读取 workflow 列表失败：${error instanceof Error ? error.message : error}`);
    }
  }
  if (offline) {
    runs = JSON.parse(readFileSync(path.resolve(ROOT, offline), "utf8"));
  } else {
    for (const wf of workflows) {
      try {
        runs[wf.file] = fetchRuns(wf.file);
      } catch (error) {
        // --json 时所有噪音都走 stderr，否则管道里拿到的就不是纯 JSON 了
        console.error(`::warning title=自动化体检::读取 ${wf.file} 的运行记录失败：${error instanceof Error ? error.message : error}`);
        unfetched.add(wf.file);
      }
    }
  }
  const { rows, problems: ageProblems, inconclusive } = auditAutomation(workflows, runs, new Date(), { maxAgeDays, unfetched });
  // 解析错误和"逾期"是两类问题：前者连跑都跑不起来，最该第一时间看到。
  const problems = [...registrationProblems, ...ageProblems];

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { generatedAt: new Date().toISOString(), repo: REPO, authenticated: Boolean(TOKEN), rows, problems, registrationProblems, inconclusive },
        null,
        2,
      ),
    );
  } else {
    console.log(`| workflow | 触发 | 期望 | 上次成功 | 逾期 | 结论 |`);
    console.log(`| --- | --- | --- | --- | --- | --- |`);
    for (const row of rows) {
      const mark = row.verdict === "ok" ? "✅" : row.verdict === "warn" ? "⚠️" : row.verdict === "unknown" ? "❔" : "❌";
      const expect = row.cadenceDays ? `每 ${row.cadenceDays} 天` : "事件驱动";
      console.log(`| ${row.file} | ${row.kind} | ${expect} | ${row.lastSuccess ?? "—"} | ${row.ageDays ?? "—"} 天 | ${mark} ${row.why} |`);
    }
  }

  if (inconclusive.length) {
    // 第 172 轮的教训：检查不可信时必须说自己不可信，不能把"读不到"当成"没跑过"。
    console.error(
      `\n::error title=自动化体检::体检不完整：${inconclusive.length} 个 workflow 的运行记录读不到（未登录 API 只有 60 次/小时，容易被限流）。` +
        ` 这些条目本轮**不做判断**：${inconclusive.join("、")}`,
    );
  }
  if (!problems.length) {
    if (inconclusive.length) return 2;
    console.log("\n✓ 自动化体检通过：每个 workflow 的最近成功都在自己的周期内");
    return 0;
  }
  for (const problem of problems) console.error(`::error title=自动化体检::${problem}`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
