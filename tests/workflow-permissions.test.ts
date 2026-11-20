/**
 * 可复用工作流的权限规则：**被调用方的权限不能高于调用方**。
 *
 * 事故（第 82 轮定位）：2026-11-18 有个提交给 deploy.yml 加了 `statuses: write`
 * （为了让失败步骤能写 commit status）。deploy.yml 同时被 daily-digest.yml /
 * weekly-roundup.yml / bulk-backfill.yml 以 `uses:` 方式调用，而这三位调用方只声明了
 * `contents: write`。
 *
 * 结果不是「某一步失败」，而是整条 workflow 在**启动阶段**就失败：
 *   conclusion = startup_failure，一个 step 都没跑，日志一片空白。
 * 于是 AI 日报从 2026-11-19 起静默停更三天 —— 文件本身完全合法，站点构建、门禁、
 * 巡检全绿，只有「产出没了」。
 *
 * 这个测试把规则变成静态检查：新增/修改权限时立刻发现，而不是等三天后看内容列表。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const WORKFLOW_DIR = new URL("../.github/workflows/", import.meta.url);

/** 权限等级：none < read < write；缺省（未声明任何 permissions）等价于全 none。 */
const LEVEL = { none: 0, read: 1, write: 2 };

async function loadWorkflows() {
  const files = (await readdir(WORKFLOW_DIR)).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  const map = new Map();
  for (const name of files) {
    const text = await readFile(new URL(name, WORKFLOW_DIR), "utf8");
    map.set(name, { text, doc: parse(text) ?? {} });
  }
  return map;
}

/** 取顶层 permissions，摊平成 { scope: level }。未声明则视为全 none。 */
export function topLevelPermissions(doc) {
  const raw = doc.permissions;
  if (raw === "write-all") return { "*": LEVEL.write };
  if (raw === "read-all") return { "*": LEVEL.read };
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object") throw new Error(`无法解析 permissions: ${String(raw)}`);
  const out = {};
  for (const [scope, level] of Object.entries(raw)) out[scope] = LEVEL[String(level)] ?? 0;
  return out;
}

/** 找出所有「调用本仓库另一个 workflow」的 job。 */
export function reusableCalls(doc) {
  const calls = [];
  for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
    if (typeof job?.uses !== "string") continue;
    const match = /^\.\/\.github\/workflows\/([\w.-]+\.ya?ml)$/.exec(job.uses);
    if (match) calls.push({ jobId, callee: match[1] });
  }
  return calls;
}

/** 纯逻辑：给出「调用方给了哪些权限、被调用方要哪些权限」→ 缺口列表。 */
export function permissionGaps(callerPermissions, calleePermissions, calleeName = "callee") {
  const gaps = [];
  for (const [scope, level] of Object.entries(calleePermissions)) {
    const granted = callerPermissions[scope] ?? callerPermissions["*"] ?? LEVEL.none;
    if (granted < level) {
      gaps.push(`${scope}: 被调用方 ${calleeName} 要 ${Object.keys(LEVEL)[level]}，调用方只给 ${Object.keys(LEVEL)[granted]}`);
    }
  }
  return gaps;
}

test("本仓库所有可复用工作流调用都不存在权限升级", async () => {
  const workflows = await loadWorkflows();
  const problems = [];
  for (const [name, { doc }] of workflows) {
    const callerPermissions = topLevelPermissions(doc);
    for (const { jobId, callee } of reusableCalls(doc)) {
      const calleeDoc = workflows.get(callee);
      assert.ok(calleeDoc, `${name} 调用了不存在的 ${callee}`);
      const gaps = permissionGaps(callerPermissions, topLevelPermissions(calleeDoc.doc), callee);
      for (const gap of gaps) problems.push(`${name} (job ${jobId}) → ${gap}`);
    }
  }
  assert.deepEqual(problems, [], `可复用工作流的权限升级会让整条 workflow startup_failure：\n${problems.join("\n")}`);
});

test("deploy.yml 要 statuses: write，所以三个调用方都必须给", async () => {
  const workflows = await loadWorkflows();
  const calleePermissions = topLevelPermissions(workflows.get("deploy.yml").doc);
  assert.equal(calleePermissions.statuses, LEVEL.write, "deploy.yml 用 statuses: write 写失败步骤状态");

  const callers = [];
  for (const [name, { doc }] of workflows) {
    if (reusableCalls(doc).some((call) => call.callee === "deploy.yml")) callers.push([name, doc]);
  }
  assert.ok(callers.length >= 2, "至少 daily-digest 和 weekly-roundup 会调用 deploy");
  for (const [name, doc] of callers) {
    assert.equal(topLevelPermissions(doc).statuses, LEVEL.write, `${name} 必须声明 statuses: write，否则启动阶段就失败`);
  }
});

test("permissionGaps 本身能正确识别升级（防止检查逻辑自己写空）", () => {
  assert.deepEqual(permissionGaps({ contents: 2 }, { contents: 1 }), [], "降级是允许的");
  const gap = permissionGaps({ contents: 2 }, { contents: 2, statuses: 2 }, "deploy.yml");
  assert.equal(gap.length, 1);
  assert.match(gap[0], /statuses/);
  assert.deepEqual(permissionGaps({ "*": 2 }, { anything: 2 }), [], "write-all 覆盖一切");
});

test("reusableCalls 只认本仓库相对路径，不误抓外部 action", () => {
  const doc = {
    jobs: {
      a: { uses: "./.github/workflows/deploy.yml" },
      b: { uses: "actions/checkout@v6" },
      c: { runs: "echo hi" },
    },
  };
  assert.deepEqual(reusableCalls(doc), [{ jobId: "a", callee: "deploy.yml" }]);
});
