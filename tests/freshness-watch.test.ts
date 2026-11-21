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

test("workflow_run 触发时报告要覆盖到上游那次运行（不再依赖 SHA 挂状态）", async () => {
  const src = await readFile(new URL("../scripts/publish-freshness-issue.mjs", import.meta.url), "utf8");
  // 改为 issue 之后不需要 SHA；但必须能从 workflow_run / 定时两种触发下都跑起来
  assert.match(src, /process\.env\.GITHUB_REPOSITORY/);
  const watch = workflow.jobs.watch.steps.map((step) => step.run ?? "").join("\n");
  assert.doesNotMatch(watch, /statuses\//, "watchdog 不再写 commit status");
});

test("权限最小化：只需要写 issue（不再往提交上挂状态）", () => {
  assert.deepEqual(workflow.permissions, { contents: "read", issues: "write" });
});

test("停更时必须让 job 红（issue 不会触发即时通知，job 失败会发邮件）", () => {
  const runs = workflow.jobs.watch.steps.map((step) => step.run ?? "").join("\n");
  assert.match(runs, /publish-freshness-issue\.mjs/, "没有维护 issue");
  assert.match(runs, /check-freshness\.mjs/, "没做停更判定");
  assert.match(runs, /exit "\$code"/, "把真实退出码传出去，停更要红");
  assert.match(runs, /::error::/, "失败时没打注解，注解是唯一能跨仓库看到的信息");
  // bash -e 的坑：读 $? 之前必须先 set +e，否则日志和注解都是死代码
  assert.match(runs, /set \+e/);
});

test("部署链路不再往提交上挂红叉（第 97 轮把上报移到 issue）", async () => {
  const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.doesNotMatch(deploy, /publish-freshness-status\.mjs/);
  const publisher = await readFile(new URL("../scripts/publish-freshness-issue.mjs", import.meta.url), "utf8");
  assert.match(publisher, /buildIssue/);
  assert.match(publisher, /--dry-run/, "缺 dry-run 就没法在不建 issue 的情况下验证");
});
