/**
 * 体积趋势（第 158 轮）。
 *
 * 全量巡检每周跑一次，原来只打印数字：逐页粗看没变化，**中位数三个月涨 40%** 这种事
 * 只有留下基线才会显形。这里测的是纯计算部分（分位数、比较、脏 JSONL 容错）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { compare, parseJsonl, percentile, summarize } from "../scripts/lib/audit-summary.mjs";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("分位数按线性插值算，边界不越界", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([10], 0.95), 10);
  assert.equal(percentile([10, 20], 0.5), 15);
  assert.equal(percentile([1, 2, 3, 4, 5], 0), 1);
  assert.equal(percentile([1, 2, 3, 4, 5], 1), 5);
});

test("汇总：失败页单独计数，最重的五页按字节排序", () => {
  const rows = [
    { url: "/a/", status: 200, bytes: 100 },
    { url: "/b/", status: 200, bytes: 400 },
    { url: "/c/", status: 200, bytes: 200 },
    { url: "/d/", status: 404, bytes: 0 },
  ];
  const stats = summarize(rows);
  assert.equal(stats.pages, 4);
  assert.equal(stats.failed, 1);
  assert.equal(stats.medianKB, 200);
  assert.deepEqual(stats.heaviest.map((h) => h.url), ["/b/", "/c/", "/a/"]);
});

test("只有明显变重才告警：涨 10% 放过、涨 30% 报", () => {
  const base = { medianKB: 200, p95KB: 200 };
  assert.deepEqual(compare({ pages: 1, failed: 0, medianKB: 210, p95KB: 215, heaviest: [] }, base).problems, []);
  const heavy = compare({ pages: 1, failed: 0, medianKB: 220, p95KB: 260, heaviest: [] }, base).problems;
  assert.equal(heavy.length, 1);
  assert.match(heavy[0], /p95 下载量 200→260 KB/);
  // 变轻不算问题
  assert.deepEqual(compare({ pages: 1, failed: 0, medianKB: 150, p95KB: 160, heaviest: [] }, base).problems, []);
});

test("没有基线时只报失败页，不编造增长", () => {
  const verdict = compare({ pages: 1, failed: 0, medianKB: 300, p95KB: 400, heaviest: [] }, null);
  assert.equal(verdict.ok, true);
});

test("坏行/半行不让巡检崩（巡检被杀时最后一行常常不完整）", () => {
  const text = '{"url":"/a/","bytes":10}\n{"url":"/b","byt\n\n{"url":"/c/","bytes":20}\n';
  const rows = parseJsonl(text);
  assert.deepEqual(rows.map((r) => r.url), ["/a/", "/c/"]);
});

test("每周巡检必须清掉当天旧的 JSONL（否则两次结果混在一起）", async () => {
  const script = await read("scripts/weekly-audit.mjs");
  const rmIndex = script.indexOf("rmSync(auditOut");
  const runIndex = script.indexOf('"scripts/audit-site.mjs"');
  assert.ok(rmIndex > 0, "要先删当天旧的 JSONL");
  assert.ok(runIndex > 0 && rmIndex < runIndex, "删除必须在跑之前");
  // 实测踩过：同一天跑两次 → 2384 页、中位数被两次结果混合
  assert.match(script, /audit-site 是 --resume 友好的\*\*追加\*\*写/, "把原因写清楚，别再犯");
});
