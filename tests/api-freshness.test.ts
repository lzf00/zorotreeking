/**
 * 线上接口"数据有多旧"（第 165 轮）。
 *
 * `/api/market/us` 的 BLS 宏观块停在 2026-08-11（102 天）没人发现：页面有静态快照
 * 兜底，肉眼看不出来；接口契约测试也只看字段全不全。这条探针只看时间戳，只发 warning。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import { PROBES, ageRows } from "../scripts/check-api-freshness.mjs";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-22T12:00:00Z");
const daysAgo = (n: number) => NOW - n * 86_400_000;

test("年龄按整天算，超阈值才算过旧", () => {
  const rows = ageRows(
    [
      { label: "刚更新", ms: daysAgo(0), maxAgeDays: 7 },
      { label: "六天前", ms: daysAgo(6), maxAgeDays: 7 },
      { label: "八天前", ms: daysAgo(8), maxAgeDays: 7 },
    ],
    NOW,
  );
  assert.deepEqual(rows.map((r) => r.ageDays), [0, 6, 8]);
  assert.deepEqual(rows.map((r) => r.stale), [false, false, true]);
});

test("读不出时间戳算过旧（沉默的接口比慢的接口更危险）", () => {
  const [row] = ageRows([{ label: "解析失败", ms: Number.NaN, maxAgeDays: 5 }], NOW);
  assert.equal(row.ageDays, null);
  assert.equal(row.stale, true);
});

test("探针读的是数据自己的时间，不是响应的 ts（缓存命中时 ts 永远是刚刚）", () => {
  const us = PROBES.find((p) => p.label.includes("BLS"));
  assert.ok(us, "要有 BLS 宏观探针");
  const payload = { ts: NOW / 1000, macro: { fetched_at: daysAgo(102) / 1000 } };
  assert.equal(us.at(payload), daysAgo(102), "必须用 macro.fetched_at");
  // 真实事故复现：顶层 ts 很新，宏观块三个月前
  const [row] = ageRows([{ label: us.label, ms: us.at(payload), maxAgeDays: us.maxAgeDays }], NOW);
  assert.equal(row.ageDays, 102);
  assert.equal(row.stale, true);
});

test("ETF 探针用基准日（交易日 15:00 北京时间），不是抓取时间", () => {
  const etf = PROBES.find((p) => p.label.includes("ETF"));
  const ms = etf.at({ ts: NOW / 1000, baseline_date: "2026-11-20" });
  assert.equal(ms, Date.parse("2026-11-20T15:00:00+08:00"));
});

test("部署流程里跑它，且永不失败", async () => {
  const wf = parse(await read(".github/workflows/deploy.yml"));
  const steps = wf.jobs["build-and-deploy"].steps as { name?: string; run?: string; "continue-on-error"?: boolean }[];
  const step = steps.find((s) => (s.name ?? "").includes("API data freshness"));
  assert.ok(step, "要有接口新鲜度步骤");
  assert.equal(step["continue-on-error"], true);
  assert.match(step.run ?? "", /check-api-freshness\.mjs/);
  assert.match(step.run ?? "", /GITHUB_STEP_SUMMARY/);

  const script = await read("scripts/check-api-freshness.mjs");
  assert.doesNotMatch(script, /process\.exit\(1\)/, "观测不是闸门");
  assert.match(script, /::warning title=线上行情接口过旧::/);
});
