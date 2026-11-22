/**
 * 自动化体检：找出「悄悄死了」的 workflow（第 179 轮）。
 *
 * 前两轮的故障都不是站点坏了，而是自动化没了：日报 cron 四天 startup_failure、
 * 停更报警器自己红在第一步。站点构建、门禁、巡检全绿，只有产出/告警消失。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { auditAutomation, cadenceDaysOf, expectationOf } from "../scripts/check-automation-health.mjs";

const NOW = new Date("2026-11-23T00:00:00Z");
const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const cron = (file: string, days: number | null = 1) => ({ file, expectation: { kind: "cron", days } });

test("cron 频率：每天 / 每周", () => {
  assert.equal(cadenceDaysOf("17 18 * * *"), 1);
  assert.equal(cadenceDaysOf("0 9 * * 0"), 7);
  assert.equal(cadenceDaysOf("30 7 * * 1-5"), 7);
  assert.equal(cadenceDaysOf("bad cron"), null);
});

test("触发方式决定要不要判逾期：只有 cron 才判，纯事件驱动永不逾期", () => {
  assert.deepEqual(expectationOf({ on: { schedule: [{ cron: "0 9 * * *" }] } }), { kind: "cron", days: 1 });
  assert.deepEqual(expectationOf({ on: { schedule: [{ cron: "0 9 * * 0" }], workflow_run: { workflows: ["x"] } } }), { kind: "mixed", days: 7 });
  assert.deepEqual(expectationOf({ on: { push: { branches: ["main"] } } }), { kind: "event", days: null });
});

test("连续失败会被抓出来（日报那次就是 startup_failure ×3）", () => {
  const { problems } = auditAutomation([cron("daily-digest.yml")], {
    "daily-digest.yml": [
      { created_at: "2026-11-21T06:00:00Z", conclusion: "startup_failure" },
      { created_at: "2026-11-20T06:00:00Z", conclusion: "startup_failure" },
      { created_at: "2026-11-19T06:00:00Z", conclusion: "startup_failure" },
    ],
  }, NOW);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /连续 3 次失败/);
});

test("逾期会被抓出来：期望每天一次，却 10 天没成功", () => {
  const { rows, problems } = auditAutomation([cron("daily-digest.yml")], {
    "daily-digest.yml": [{ created_at: "2026-11-13T06:00:00Z", conclusion: "success" }],
  }, NOW);
  assert.equal(rows[0].verdict, "problem");
  assert.match(problems[0], /逾期 9 天/);
});

test("只有 cron 却从来没跑过 = problem；事件驱动没跑过不算", () => {
  const cronNever = auditAutomation([cron("a11y.yml", 7)], {}, NOW);
  assert.equal(cronNever.problems.length, 1);
  assert.match(cronNever.problems[0], /从来没有运行过/);
  const pushNever = auditAutomation([{ file: "x.yml", expectation: { kind: "event", days: null } }], {}, NOW);
  assert.deepEqual(pushNever.problems, []);
});

test("健康样本保持安静（防止检查逻辑自己写空到一个永远红的程度）", () => {
  const { problems } = auditAutomation([cron("deploy.yml", 1)], {
    "deploy.yml": [{ created_at: "2026-11-22T18:00:00Z", conclusion: "success" }],
  }, NOW);
  assert.deepEqual(problems, []);
});

test("已接进每周巡检，且巡检步骤带了 token", async () => {
  const audit = await read("scripts/weekly-audit.mjs");
  assert.match(audit, /check-automation-health\.mjs/);
  assert.match(audit, /自动化体检/);
  const deploy = await read(".github/workflows/deploy.yml");
  assert.match(deploy, /id: weekly-audit\n\s+env:\n(?:.*\n)*?\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
});
