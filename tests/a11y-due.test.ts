/**
 * 全站无障碍审计的排程与自动化体检的诚实性（第 180 轮）。
 *
 * 事实背景：第 179 轮的自动化体检第一次跑就报出 **`a11y.yml` 从来没有运行记录** ——
 * 它只有 cron，而本仓库 cron 会延迟 5–7 小时甚至整周不触发。于是一整套"全站 1190 页 ×
 * 浅/深两套"的 axe 审计形同不存在，无障碍只剩门禁里抽样 22 页的检查。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { decideDue } from "../scripts/a11y-due.mjs";
import { auditAutomation } from "../scripts/check-automation-health.mjs";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const NOW = new Date("2026-11-23T00:00:00Z");

test("判旧：没戳记 → 要跑（宁多跑一次，不要静默跳过）", () => {
  assert.equal(decideDue(null, NOW, 7).due, true);
  assert.equal(decideDue("不是日期", NOW, 7).due, true);
  assert.match(decideDue(undefined, NOW, 7).reason, /没有审计戳记/);
});

test("判旧：7 天内不跑，超过就跑", () => {
  assert.equal(decideDue("2026-11-20T00:00:00Z", NOW, 7).due, false);
  const aged = decideDue("2026-11-10T00:00:00Z", NOW, 7);
  assert.equal(aged.due, true);
  assert.equal(Math.floor(aged.ageDays), 13);
});

test("自动化体检：读不到运行记录 ≠ 从来没跑过（第 172 轮的教训）", () => {
  const wf = [{ file: "a11y.yml", expectation: { kind: "cron", days: 7 } }];
  const { rows, problems, inconclusive } = auditAutomation(wf, {}, NOW, { unfetched: new Set(["a11y.yml"]) });
  assert.deepEqual(problems, [], "读不到时不许报「从来没有运行过」");
  assert.deepEqual(inconclusive, ["a11y.yml"]);
  assert.equal(rows[0].verdict, "unknown");
  assert.match(rows[0].why, /读不到运行记录/);
});

test("自动化体检：真的没跑过才是 problem", () => {
  const wf = [{ file: "site-audit.yml", expectation: { kind: "cron", days: 7 } }];
  const { problems } = auditAutomation(wf, {}, NOW, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /从来没有运行过/);
});

test("a11y.yml 不再只有 cron：有 workflow_run 触发 + 判旧闸 + 戳记回写", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  assert.match(yml, /workflow_run:\n\s+workflows: \["Build & Deploy"\]/);
  assert.match(yml, /node scripts\/a11y-due\.mjs --max-age-days=7/);
  assert.match(yml, /steps\.due\.outputs\.due == 'true'/, "贵步骤必须挂在判旧结果上");
  assert.match(yml, /src\/data\/a11y-audit\.json/, "戳记必须回写仓库，否则每次部署都重跑 20 分钟");
  assert.match(yml, /contents: write/);
});

test("戳记必须在所有检查之后才记（失败不能算「跑过了」）", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  const stampAt = yml.indexOf("name: Record the audit stamp");
  for (const later of ["Spot-check phone width", "Island hydration smoke test"]) {
    assert.ok(yml.indexOf(later) > 0 && yml.indexOf(later) < stampAt, `${later} 必须在记戳记之前`);
  }
});
