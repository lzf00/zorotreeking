/**
 * 部署要能自己补上停更的内容（第 113 轮）。
 *
 * 现实是：本仓库的 schedule 实测延迟 5–7.5 小时，还出现过**整天不触发**；
 * 2026-11-19 起 AI 日报连续三天没有产出，而站点照常构建、门禁全绿、巡检 0 失败 ——
 * 因为「少一篇文章」不是错误。这种停更只能靠人肉发现，而人不会每天守着。
 *
 * 所以把「发现 + 补一次」挂在每次部署的末尾：失败不影响部署结论，只在真的停更时动。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const wf = parse(await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"));
const job = wf.jobs["catch-up-digest"];
const steps: { name?: string; run?: string; if?: string; env?: Record<string, string>; "continue-on-error"?: boolean }[] =
  job.steps;
const byName = new Map(steps.map((s) => [s.name, s]));

test("补跑是独立 job，且不会把整条 run 判成失败", () => {
  assert.ok(job, "没有 catch-up-digest job：停更又只能靠人肉发现了");
  assert.equal(job["continue-on-error"], true, "补跑失败不该让整条 run 变红");
  assert.equal(job.needs, "build-and-deploy", "必须等部署结束再补跑");
  const step = byName.get("Catch up a missed digest (self-healing)");
  assert.ok(step, "job 里没有补跑步骤");
});

test("单独成 job 的理由：部署 job 只有 30 分钟预算，补跑要抓源十几分钟", () => {
  const deployJob = wf.jobs["build-and-deploy"];
  assert.ok(deployJob["timeout-minutes"] <= 30, "部署预算变了，重新评估补跑是否还能塞在里面");
  assert.ok(job["timeout-minutes"] >= 20, "补跑要抓源 + 翻译，预算太小会天天超时");
  const deployStepNames = deployJob.steps.map((s: { name?: string }) => s.name);
  assert.ok(!deployStepNames.includes("Catch up a missed digest (self-healing)"), "补跑不该再塞在部署 job 里");
});

test("补跑排在验收之后（内容问题不能影响本次部署结论）", () => {
  const jobs = Object.keys(wf.jobs);
  assert.ok(jobs.indexOf("catch-up-digest") > jobs.indexOf("build-and-deploy"), "补跑 job 要排在部署 job 之后");
  const deploySteps = wf.jobs["build-and-deploy"].steps.map((s: { name?: string }) => s.name);
  assert.ok(deploySteps.includes("Production acceptance smoke test"), "部署 job 里找不到验收步骤");
});

test("只在 push / schedule 触发，避免被调用时递归补跑", () => {
  assert.match(job.if ?? "", /github\.event_name == 'push'/);
  assert.doesNotMatch(job.if ?? "", /workflow_call/);
});

test("步骤逻辑：先查新鲜度、只提交内容目录、空产出不提交", () => {
  const run = byName.get("Catch up a missed digest (self-healing)")!.run ?? "";
  assert.match(run, /check-freshness\.mjs --max-age=2/, "要用既有的停更看门狗判定，别自己写一套");
  assert.match(run, /digest-fetch\.ts both/);
  assert.match(run, /git add src\/content\b/, "只能提交内容目录，避免把工作区其它改动带上");
  assert.match(run, /git diff --cached --quiet/, "没有新增内容就不该制造空提交");
  assert.doesNotMatch(run, /git add -A|git add \./, "别用 git add -A");
});

test("补跑必须同时翻译，并且中英不成对就回滚（第一次补跑就撞到的坑）", () => {
  const run = byName.get("Catch up a missed digest (self-healing)")!.run ?? "";
  assert.match(run, /translate-digest\.ts/, "只生成中文会让 /en/... 变成死链 —— 第 113 轮第一次补跑就红在 check:links");
  assert.match(run, /\.en\.mdx/, "要检查 en 版是否存在");
  assert.match(run, /git checkout -- src\/content/, "不成对时要回滚");
});

test("权限足够 push，且不超出调用方（reusable workflow 的老坑）", () => {
  assert.equal(job.permissions?.contents, "write", "补跑要 commit，job 本身就得有 contents: write");
  assert.equal(wf.permissions.contents, "write", "可复用 workflow 顶层也得声明，否则调用方限制会盖掉");
  const step = byName.get("Catch up a missed digest (self-healing)")!;
  assert.ok(step.env?.DOUBAO_API_KEY, "没给 LLM key，补跑必然空跑");
});

test("三个调用方都给了 contents: write（否则被调用时启动阶段就死）", async () => {
  for (const file of ["daily-digest.yml", "weekly-roundup.yml", "bulk-backfill.yml"]) {
    const caller = parse(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"));
    assert.equal(caller.permissions?.contents, "write", `${file} 调用 deploy 却没有 contents: write`);
  }
});
