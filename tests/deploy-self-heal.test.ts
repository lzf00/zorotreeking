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
const job = wf.jobs["build-and-deploy"];
const steps: { name?: string; run?: string; if?: string; env?: Record<string, string>; "continue-on-error"?: boolean }[] =
  job.steps;
const byName = new Map(steps.map((s) => [s.name, s]));

test("补跑步骤存在，且不会把部署判成失败", () => {
  const step = byName.get("Catch up a missed digest (self-healing)");
  assert.ok(step, "部署里没有自愈补跑步骤，停更又只能靠人肉发现了");
  assert.equal(step!["continue-on-error"], true, "补跑失败不该让一次成功的部署变红");
});

test("补跑排在验收之后（内容问题不能影响本次部署结论）", () => {
  const names = steps.map((s) => s.name);
  const accept = names.indexOf("Production acceptance smoke test");
  const heal = names.indexOf("Catch up a missed digest (self-healing)");
  assert.ok(accept > 0 && heal > accept, `顺序不对：验收 ${accept}，补跑 ${heal}`);
});

test("只在 push / schedule 触发，避免被调用时递归补跑", () => {
  const step = byName.get("Catch up a missed digest (self-healing)")!;
  assert.match(step.if ?? "", /github\.event_name == 'push'/);
  assert.doesNotMatch(step.if ?? "", /workflow_call/);
});

test("步骤逻辑：先查新鲜度、只提交内容目录、空产出不提交", () => {
  const run = byName.get("Catch up a missed digest (self-healing)")!.run ?? "";
  assert.match(run, /check-freshness\.mjs --max-age=2/, "要用既有的停更看门狗判定，别自己写一套");
  assert.match(run, /digest-fetch\.ts both/);
  assert.match(run, /git add src\/content\b/, "只能提交内容目录，避免把工作区其它改动带上");
  assert.match(run, /git diff --cached --quiet/, "没有新增内容就不该制造空提交");
  assert.doesNotMatch(run, /git add -A|git add \./, "别用 git add -A");
});

test("权限足够 push，且不超出调用方（reusable workflow 的老坑）", () => {
  assert.equal(wf.permissions.contents, "write", "补跑要 commit，deploy 本身就得有 contents: write");
  const step = byName.get("Catch up a missed digest (self-healing)")!;
  assert.ok(step.env?.DOUBAO_API_KEY, "没给 LLM key，补跑必然空跑");
});

test("三个调用方都给了 contents: write（否则被调用时启动阶段就死）", async () => {
  for (const file of ["daily-digest.yml", "weekly-roundup.yml", "bulk-backfill.yml"]) {
    const caller = parse(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"));
    assert.equal(caller.permissions?.contents, "write", `${file} 调用 deploy 却没有 contents: write`);
  }
});
