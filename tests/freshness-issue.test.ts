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
