/**
 * 外链体检必须在周巡检里跑，且是"报告"不是"门禁"（第 132 轮）。
 *
 * 为什么不进门禁：5508 条外链，全量抓一轮 8–12 分钟，且新闻站经常抽风；
 * 放进每次提交的 gate 只会让人习惯性忽略红叉（第 130 轮刚吃过这个亏）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = () => readFile(new URL("../.github/workflows/site-audit.yml", import.meta.url), "utf8");

test("周巡检有外链体检步骤，且允许失败", async () => {
  const yml = await workflow();
  // 取到下一个步骤为止，整段都在范围内（heredoc 很长，不能只截前 600 字）
  const step = (yml.split("- name: External links")[1] ?? "").split("\n      - name:")[0];
  assert.ok(step, "site-audit.yml 里没有 External links 步骤");
  assert.match(step, /continue-on-error: true/, "外链体检手滑失败不该让整个周巡检红");
  assert.match(step, /check-external-links\.mjs/);
  assert.match(step, /GITHUB_STEP_SUMMARY/, "结果要进 run 页面，否则等于没跑");
});

test("外链体检不进 npm run gate（8–12 分钟且依赖外部站点）", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["check:external-links"], /check-external-links\.mjs/);
  assert.doesNotMatch(pkg.scripts.gate, /check:external-links/);
});
