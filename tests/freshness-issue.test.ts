/**
 * 内容停更用 Issue 报，不用 commit status（第 97 轮）。
 *
 * 第 85 轮的 `content/freshness` commit status 让**每个提交都挂红叉**（日报停更那几天，
 * 所有 commit 的合并状态都是 failure），真正的部署/烟测失败被淹掉 → 警报疲劳。
 * Issue 才是内容运维该走的通道：持久、可关、会发邮件、不挡代码。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import { ISSUE_LABEL, ISSUE_TITLE, buildIssue, decide, pickIssue } from "../scripts/lib/freshness-issue.mjs";
import { isMissingLabel, splitCurlOutput } from "../scripts/publish-freshness-issue.mjs";

const staleSummary = {
  ok: false,
  today: "2026-11-21",
  rows: [
    { stream: "AI 日报", newest: "2026-11-18", level: "fail", message: "阈值 2 天" },
    { stream: "市场复盘", newest: "2026-11-20", level: "ok" },
    { stream: "投资日报", newest: "2026-11-19", level: "warn" },
  ],
};

test("停更 → 打开 issue，正文点名哪个板块、最新是哪天", () => {
  const issue = buildIssue(staleSummary);
  assert.equal(issue.action, "open");
  assert.equal(issue.title, ISSUE_TITLE);
  assert.match(issue.body, /AI 日报/);
  assert.match(issue.body, /2026-11-18/);
  assert.match(issue.body, /停更/);
  // 需要有人能照着做的处理步骤，而不是只报个红
  assert.match(issue.body, /怎么处理/);
  assert.match(issue.body, /startup_failure|Actions/);
});

test("恢复 → 关闭 issue，不留停更文案", () => {
  const issue = buildIssue({ ...staleSummary, ok: true, rows: staleSummary.rows.map((row) => ({ ...row, level: "ok" })) });
  assert.equal(issue.action, "close");
  assert.doesNotMatch(issue.body, /\*\*停更\*\*/);
  assert.match(issue.body, /已恢复/);
});

test("按标题认领 issue（关闭的也要能找回并重开）", () => {
  const issues = [
    { number: 7, title: "别的 issue", state: "open" },
    { number: 9, title: ISSUE_TITLE, state: "closed" },
  ];
  assert.equal(pickIssue(issues)?.number, 9);
  assert.equal(pickIssue([]), null);
});

test("幂等：已经是目标状态就什么都不做，避免每天刷 body 制造噪音", () => {
  assert.deepEqual(decide({ action: "close" }, null), { method: "none" });
  assert.deepEqual(decide({ action: "close" }, { state: "closed" }), { method: "none" });
  assert.equal(decide({ action: "close" }, { state: "open" }).method, "PATCH");
  assert.equal(decide({ action: "open" }, null).method, "POST");
  assert.equal(decide({ action: "open" }, { state: "closed" }).method, "PATCH");
  assert.equal(decide({ action: "open" }, { state: "closed" }).reason, "reopen");
  assert.equal(decide({ action: "open" }, { state: "open" }).reason, "refresh-body");
});

test("workflow 侧：watchdog 维护 issue，deploy 不再往提交上挂红叉", async () => {
  const watch = parse(await readFile(new URL("../.github/workflows/freshness-watch.yml", import.meta.url), "utf8"));
  assert.deepEqual(watch.permissions, { contents: "read", issues: "write" });
  const runs = watch.jobs.watch.steps.map((step) => step.run ?? "").join("\n");
  assert.match(runs, /publish-freshness-issue\.mjs/);
  assert.equal(watch.jobs.watch.steps.find((s) => s.concurrency) ?? null, null);

  const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.doesNotMatch(deploy, /publish-freshness-status\.mjs/, "deploy 还在写 commit status");
  assert.doesNotMatch(deploy, /context.*content\/freshness/, "deploy 还在用旧 context");
});

test("标签只在建 issue 时给，更新时不覆盖人工标签", async () => {
  const src = await readFile(new URL("../scripts/publish-freshness-issue.mjs", import.meta.url), "utf8");
  assert.match(src, new RegExp(`ISSUE_LABEL`));
  // 关闭那条 PATCH 只发 state，不带 labels
  assert.match(src, /state: "closed", state_reason: "completed"/);
  assert.doesNotMatch(src, /labels: \[ISSUE_LABEL\][^}]*state: "closed"/);
});

// ── 第 178 轮：报警器自己不能坏 ─────────────────────────────────────────────
//
// 11-22 那次 `freshness-watch` 的结论是 failure，但**挂的是"同步 issue"这一步**，
// 排在后面的「内容到底停没停更」被 GitHub 跳过（默认一步失败后不再跑后续步骤）。
// 触发条件很朴素：仓库里 issue 数为 0、`content/freshness` label 也不存在，
// 第一次真要报警时 POST /issues 带着不存在的 label 被 422 拒掉。

test("curl 输出按最后一个换行切出状态码（响应体自己带换行也不怕）", () => {
  assert.deepEqual(splitCurlOutput('{\n  "number": 7\n}\n201'), { status: 201, body: { number: 7 } });
  assert.deepEqual(splitCurlOutput('{"message":"x"}\n422'), { status: 422, body: { message: "x" } });
});

test("非 JSON 响应（网关 HTML）不会让 JSON.parse 抛异常", () => {
  const parsed = splitCurlOutput("<html>502 Bad Gateway</html>\n502");
  assert.equal(parsed.status, 502);
  assert.match(parsed.body.message, /Bad Gateway/);
});

test("空响应 → status 0，上层走「只打印」分支", () => {
  assert.deepEqual(splitCurlOutput(""), { status: 0, body: null });
});

test("只有 422 且提到 label 才算「缺 label」", () => {
  assert.equal(
    isMissingLabel({ status: 422, body: { message: "Validation Failed", errors: [{ resource: "Issue", field: "labels", code: "invalid" }] } }),
    true,
  );
  assert.equal(isMissingLabel({ status: 422, body: { message: "Validation Failed", errors: [{ field: "title" }] } }), false);
  assert.equal(isMissingLabel({ status: 403, body: { message: "label" } }), false);
  assert.equal(isMissingLabel(null), false);
});

test("workflow：报告步骤不挡判定，判定步骤一定跑", async () => {
  const yml = await readFile(new URL("../.github/workflows/freshness-watch.yml", import.meta.url), "utf8");
  assert.match(yml, /- name: Sync freshness issue\n(?:.*\n)*?\s+continue-on-error: true/);
  assert.match(yml, /- name: Fail the run when a stream is stale\n\s+if: always\(\)/);
});

test("脚本：报告阶段抛错也 exit 0，缺 label 会先建 label", async () => {
  const script = await readFile(new URL("../scripts/publish-freshness-issue.mjs", import.meta.url), "utf8");
  assert.match(script, /try \{\n\s+await main\(\);/);
  assert.match(script, /::warning::同步 issue 时出错，本轮跳过/);
  assert.match(script, /label「\$\{ISSUE_LABEL\}」不存在，先创建它/);
  assert.match(script, /改为不带 label 建 issue/);
});
