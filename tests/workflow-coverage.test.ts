/**
 * workflow 触发方式体检（第 162 轮）。
 *
 * 这个仓库的 `schedule` 实测会延迟 5–7.5 小时、甚至整天不触发：日报停更三天、
 * 「本周看点」缺一期、a11y/site-audit/deadlink 从未跑过，都是同一个根因。
 * 这条守卫的作用是**下次加一个只有 cron 的 workflow 时，门禁当场变红**。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { auditWorkflows, loadWorkflows, triggersOf } from "../scripts/check-workflows.mjs";

const coverage = {
  "covered.yml": "部署流程自愈",
  "gap.yml": "accepted: 已知缺口，需要决策",
  _doc: "注释不算声明",
};

test("触发方式解析：YAML 把 on 解析成 true 时也认", () => {
  assert.deepEqual(triggersOf({ on: { schedule: [], workflow_run: {} } }).sort(), ["schedule", "workflow_run"]);
  assert.deepEqual(triggersOf({ true: { schedule: [], push: {} } }).sort(), ["push", "schedule"]);
  assert.deepEqual(triggersOf({ on: "push" }), ["push"]);
  // workflow_dispatch 不算"有人会跑它"
  assert.deepEqual(triggersOf({ on: { schedule: [], workflow_dispatch: {} } }), ["schedule"]);
});

test("有 workflow_run/push 的 scheduled workflow 视为安全（cron 只是兜底）", () => {
  const { rows, problems } = auditWorkflows([{ file: "x.yml", triggers: ["schedule", "workflow_run"] }], {});
  assert.equal(rows[0].verdict, "ok");
  assert.deepEqual(problems, []);
});

test("只有 cron 又没有声明 → 直接报问题", () => {
  const { rows, problems } = auditWorkflows([{ file: "lonely.yml", triggers: ["schedule"] }], {});
  assert.equal(rows[0].verdict, "problem");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /只有 cron 触发/);
});

test("声明了覆盖方式就放过；accepted: 记成已知缺口而不是失败", () => {
  const covered = auditWorkflows([{ file: "covered.yml", triggers: ["schedule"] }], {
    "covered.yml": coverage["covered.yml"],
  });
  assert.equal(covered.rows[0].verdict, "ok");
  assert.deepEqual(covered.problems, []);

  const gap = auditWorkflows([{ file: "gap.yml", triggers: ["schedule"] }], {
    "gap.yml": coverage["gap.yml"],
  });
  assert.equal(gap.rows[0].verdict, "accepted");
  assert.match(gap.rows[0].why, /需要决策/);
  assert.deepEqual(gap.problems, []);
});

test("清单里有不存在的 workflow 也要报（防止声明腐烂）", () => {
  const { problems } = auditWorkflows([{ file: "a.yml", triggers: ["push"] }], coverage);
  assert.ok(problems.some((p) => p.includes("covered.yml") && p.includes("已经不存在")));
});

test("仓库现状本身必须通过（不许有未登记的 cron-only workflow）", async () => {
  const manifest = JSON.parse(await readFile(new URL("../scripts/workflow-coverage.json", import.meta.url), "utf8"));
  const { problems } = auditWorkflows(loadWorkflows(), manifest);
  assert.deepEqual(problems, [], "新加的 workflow 要么接到部署/每周巡检，要么写进 workflow-coverage.json");
});

test("门禁要真的跑它", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["check:workflows"], "node scripts/check-workflows.mjs");
  assert.match(pkg.scripts.gate, /npm run check:workflows/, "不进门禁等于没有守卫");
  // 踩过一次：只替换了 `validate:etf &&`，把前面的 `npm run ` 落在了后面 → 门禁直接 127
  assert.match(pkg.scripts.gate, /npm run check:workflows && npm run validate:etf/, "拼接后每条命令都要完整");
});
