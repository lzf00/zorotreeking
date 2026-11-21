/**
 * 定时新鲜度看门狗（第 94 轮）。
 *
 * 结构缺口：`content/freshness` 状态是部署时写的，而部署只在有人 push / 工作日定时跑。
 * 内容流水线自己坏掉、当天又没人 push 时，没有任何信号会红 —— 2026-11-19 的
 * 三天静默停更就是这么发生的。这个 workflow 不依赖提交，每天自己跑一次。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const source = await readFile(new URL("../.github/workflows/freshness-watch.yml", import.meta.url), "utf8");
const workflow = parse(source);

test("主通道挂在日报跑完之后（workflow_run），定时只是兜底", () => {
  // 实测这个仓库的 schedule 会延迟 5–7 小时，靠 cron 卡不准「日报到底出了没有」，
  // 所以必须有一条「日报一完成就检查」的通道。
  assert.deepEqual(workflow.on.workflow_run, { workflows: ["Daily digest"], types: ["completed"] });
  assert.ok(workflow.on?.schedule?.length, "没有兜底 schedule：日报连跑都没跑时也要能发现");

  const cron = workflow.on.schedule[0].cron;
  assert.match(cron, /^\d+ \d+ \* \* \*$/, `cron 应该是每天一次，收到 ${cron}`);
  const [minute, hour] = cron.split(" ").map(Number);
  assert.notEqual(minute, 0, "错开整点：整点是 GitHub 全球 cron 的最高峰，实际会延迟好几个小时");
  // 日报 UTC 18:17 开跑、约 70 分钟跑完 → 兜底检查必须晚于 19:30 UTC
  assert.ok(hour * 60 + minute >= 19 * 60 + 30, `兜底 cron 要在日报窗口之后，收到 ${cron}`);
  assert.ok(workflow.on.workflow_dispatch !== undefined, "缺少手动触发，排障时跑不了");
});

test("状态挂在读者会点开的那次提交上（workflow_run 用上游 SHA）", () => {
  const step = workflow.jobs.watch.steps.find((s) => s.env?.GITHUB_SHA);
  assert.ok(step, "没有设置 GITHUB_SHA");
  assert.match(String(step.env.GITHUB_SHA), /github\.event\.workflow_run\.head_sha/, "workflow_run 触发时要用上游 head_sha");
  assert.match(String(step.env.GITHUB_SHA), /\|\|\s*github\.sha/, "定时/手动触发要回落到当前 HEAD");
});

test("权限最小化：只需要写 commit status", () => {
  assert.deepEqual(workflow.permissions, { contents: "read", statuses: "write" });
});

test("停更时必须让 job 红（commit status 不会触发通知，job 失败才会）", () => {
  const runs = workflow.jobs.watch.steps.map((step) => step.run ?? "").join("\n");
  assert.match(runs, /publish-freshness-status\.mjs/, "没写 commit status");
  assert.match(runs, /check-freshness\.mjs/, "没做停更判定");
  assert.match(runs, /exit "\$code"/, "把真实退出码传出去，停更要红");
  assert.match(runs, /::error::/, "失败时没打注解，注解是唯一能跨仓库看到的信息");
  // bash -e 的坑：读 $? 之前必须先 set +e，否则日志和注解都是死代码
  assert.match(runs, /set \+e/);
});

test("与部署用的是同一个 context，最新一条状态生效", async () => {
  const publisher = await readFile(new URL("../scripts/publish-freshness-status.mjs", import.meta.url), "utf8");
  assert.match(publisher, /export const CONTEXT = "content\/freshness"/);
  const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(deploy, /publish-freshness-status\.mjs/, "部署时也要写同一个状态，否则两处会打架");
});
