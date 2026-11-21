/**
 * 宏观刷新工作流的约束（第 136 轮）。
 *
 * 数据陈旧 102 天的根因不是"抓不到"（BLS 公开 API 一直是通的），而是**没有定时任务**。
 * 这个工作流每天跑一次、只在数字变化时提交；这里锁住几件容易改坏的事。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("宏观刷新工作流：每天定时 + 手动触发 + 只在有变化时提交", async () => {
  const workflow = await read(".github/workflows/refresh-us-macro.yml");
  assert.match(workflow, /cron: "20 22 \* \* \*"/, "要有每日常规刷新");
  assert.match(workflow, /workflow_dispatch:/, "要能手动补跑");
  assert.match(workflow, /node scripts\/fetch-us-macro\.mjs/, "调用抓取脚本");
  assert.match(workflow, /git diff --quiet -- src\/data\/us-market-latest\.json/, "没变化就不提交");
  assert.match(workflow, /contents: write/, "需要写权限才能提交");
});

test("刷新脚本只碰宏观块，不动行情块", async () => {
  const script = await read("scripts/fetch-us-macro.mjs");
  assert.match(script, /macro: result\.macro/);
  // 行情块（东方财富）不在本仓库的采集范围：整份 JSON 里只允许覆盖 macro/ts/stale
  assert.doesNotMatch(script, /market:\s*\{/, "不要在宏观脚本里伪造行情数据");
  assert.match(script, /--dry-run/, "要能空跑检查");
});

test("页面用到的宏观字段都必须被写入（含 unemployment.reference）", async () => {
  const { computeUsMacro } = await import("../scripts/lib/us-macro-compute.mjs");
  const row = (year: string, month: number, value: number) => ({
    year, period: `M${String(month).padStart(2, "0")}`, value: String(value), footnotes: [{}],
  });
  const flat = (base: number) => Array.from({ length: 26 }, (_, index) => row(String(2024 + Math.floor(index / 12)), (index % 12) + 1, base + index));
  const result = computeUsMacro({
    cpi: flat(100), core_cpi: flat(100), payroll: flat(159_000), unemployment: flat(4),
  }, { fetchedAt: 1_800_000_000 });
  assert.equal(result.ok, true);
  for (const key of ["cpi", "core_cpi", "payroll", "unemployment"]) {
    const metric = result.macro[key];
    assert.equal(typeof metric.reference, "string", `${key}.reference 必须是字符串（页面拿它显示参考期）`);
    assert.equal(typeof metric.actual, "number", `${key}.actual 必须是数字`);
  }
});
