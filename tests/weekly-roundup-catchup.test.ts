/**
 * 「本周看点」自愈（第 161 轮）。
 *
 * `weekly-roundup.yml` 只有 cron，而这个仓库的 schedule 会延迟甚至整天不触发 ——
 * 周日没跑就等于永久缺一期，而站点照常构建、门禁全绿。这条自愈挂在部署流程里：
 * 目标周 = 最近一个周日的 ISO 周，缺才生成。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import { isoWeek, roundupState, targetWeek, weekLabel } from "../scripts/check-weekly-roundup.mjs";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("ISO 周：常规周一为起点", () => {
  assert.equal(weekLabel(isoWeek(2026, 11, 22)), "2026-W47", "周日属于本 ISO 周");
  assert.equal(weekLabel(isoWeek(2026, 11, 15)), "2026-W46");
  assert.equal(weekLabel(isoWeek(2026, 1, 1)), "2026-W01");
});

test("ISO 周：跨年边界（最容易写错的地方）", () => {
  // 2027-01-01 是周五，属于 2026 年的第 53 周
  assert.equal(weekLabel(isoWeek(2027, 1, 1)), "2026-W53");
  // 2024-12-30 是周一，属于 2025 年第 1 周
  assert.equal(weekLabel(isoWeek(2024, 12, 30)), "2025-W01");
});

test("目标周：周日当天是本周，之后归到刚结束的那周", () => {
  const sunday = new Date("2026-11-22T02:00:00Z"); // 北京 10:00 周日
  assert.equal(weekLabel(targetWeek(sunday)), "2026-W47");
  const monday = new Date("2026-11-23T02:00:00Z");
  assert.equal(weekLabel(targetWeek(monday)), "2026-W47", "周一还要认上周末那周");
  const saturday = new Date("2026-11-28T02:00:00Z");
  assert.equal(weekLabel(targetWeek(saturday)), "2026-W47", "周六也不该提前生成下一周");
});

test("状态判定：缺 zh 要生成、缺 en 要翻译、都有就收手", () => {
  assert.equal(roundupState({ zh: false, en: false }).exitCode, 10);
  assert.equal(roundupState({ zh: true, en: false }).exitCode, 11);
  assert.equal(roundupState({ zh: true, en: true }).exitCode, 0);
});

test("部署流程里挂着这条自愈，且带质量闸", async () => {
  const workflow = parse(await read(".github/workflows/deploy.yml"));
  const steps = workflow.jobs["catch-up-digest"].steps as { name?: string; run?: string; env?: Record<string, string> }[];
  const step = steps.find((s) => (s.name ?? "").includes("Weekly roundup"));
  assert.ok(step, "catch-up-digest 里要有周报自愈步骤");
  assert.match(step.run ?? "", /check-weekly-roundup\.mjs/, "用检查器判断缺不缺");
  assert.match(step.run ?? "", /weekly-roundup\.ts/, "缺的时候才生成");
  assert.match(step.run ?? "", /translate-digest\.ts/, "生成完要补英文版（缺 en 会死链）");
  assert.match(step.run ?? "", /check-digest-placeholders/, "占位符不许发出去");
  assert.match(step.run ?? "", /git checkout -- src\/content/, "任何一道闸不过都要回滚");
  assert.match(step.run ?? "", /dispatches/, "机器人 push 不触发 workflow，要手动 dispatch");
  assert.equal(step.env?.DOUBAO_API_KEY, "${{ secrets.DOUBAO_API_KEY }}");
});

test("周报脚本自己仍然只写中文（英文由翻译补齐，别指望它）", async () => {
  const script = await read("scripts/weekly-roundup.ts");
  assert.match(script, /\.zh\.mdx/);
  assert.doesNotMatch(script, /\.en\.mdx/, "en 版是 translate-digest 产出的");
});
