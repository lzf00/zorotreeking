import assert from "node:assert/strict";
import test from "node:test";

import { buildStatuses, contextFor, summarizeDescription } from "../scripts/lighthouse-statuses.mjs";

test("context 名带 perf/ 前缀，路径原样保留", () => {
  assert.equal(contextFor("https://www.zorotreeking.online/"), "perf/");
  assert.equal(contextFor("https://www.zorotreeking.online/invest/digest/"), "perf/invest/digest/");
  assert.equal(contextFor("/hike/sample-route/"), "perf/hike/sample-route/");
  // 已经传路径也不重复加斜杠
  assert.equal(contextFor("invest/"), "perf/invest/");
});

test("每条 URL 一个状态，描述里带分数/LCP/TBT/CLS", () => {
  const statuses = buildStatuses(
    [
      { url: "https://www.zorotreeking.online/", perf: 0.98, lcp: 522, tbt: 10, cls: 0 },
      { url: "https://www.zorotreeking.online/invest/digest/", perf: 0.934, lcp: 843, tbt: 633, cls: 0 },
    ],
    { runUrl: "https://github.com/o/r/actions/runs/1" },
  );
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].context, "perf/");
  assert.equal(statuses[0].state, "success");
  assert.equal(statuses[0].description, "98 分 · LCP 0.52s · TBT 10ms · CLS 0.000");
  assert.equal(statuses[1].context, "perf/invest/digest/");
  // TBT 633 ms 超过 warn 线（300 ms），所以描述尾部带「告警 1」——但状态仍是 success
  assert.equal(statuses[1].description, "93 分 · LCP 0.84s · TBT 633ms · CLS 0.000 · 告警 1");
  assert.equal(statuses[1].state, "success");
  assert.equal(statuses[1].target_url, "https://github.com/o/r/actions/runs/1");
});

test("性能分只告警，缺分数才记 failure（没测到 ≠ 没超标）", () => {
  const [low, missing, ok] = buildStatuses([
    { url: "/a/", perf: 0.79, lcp: 2000, tbt: 200, a11y: 1, seo: 1 },
    { url: "/b/", perf: NaN, lcp: NaN, tbt: NaN },
    { url: "/c/", perf: 0.8, lcp: 1000, tbt: 0, a11y: 1, seo: 1 },
  ]);
  // 0.79 分但 LCP 2.0 s：`.lighthouserc.json` 里性能是 warn，所以不挂红叉
  assert.equal(low.state, "success");
  assert.match(low.description, /告警 1/);
  // 完全没分数：要么报告缺页、要么审计没跑成，不能变绿
  assert.equal(missing.state, "failure");
  assert.equal(missing.description.startsWith("— 分"), true);
  // 正好 0.80 算过（和 assert 的 warn 阈值一致）
  assert.equal(ok.state, "success");
});

test("描述长度不超过 GitHub 的 140 字符上限", () => {
  const [status] = buildStatuses([{ url: "/x/", perf: 0.5, lcp: 123456, tbt: 123456, cls: 0.123456 }]);
  assert.ok(status.description.length <= 140, status.description);
});

test("perf/audited 的描述写「最低分」而不是「中位数」——预算看的是最差那页", () => {
  const rows = [
    { url: "https://x/", perf: 0.97, lcp: 900, tbt: 0, cls: 0 },
    { url: "https://x/hike/", perf: 0.96, lcp: 840, tbt: 0, cls: 0.02 },
    { url: "https://x/invest/digest/", perf: 0.93, lcp: 1020, tbt: 4, cls: 0 },
  ];
  assert.equal(summarizeDescription(rows, "c2bf9d616cf2ed590285d7246972b2c4a76371cd"), "audited c2bf9d6 · 3 URL · 最低 93 · 中位 96");
});

test("没有报告时不假装有分数", () => {
  assert.equal(summarizeDescription([], "abcdef1234567"), "audited abcdef1 · 无报告");
  assert.equal(
    summarizeDescription([{ url: "/a/", perf: NaN, lcp: NaN, tbt: NaN }], "abcdef1234567"),
    "audited abcdef1 · 未拿到性能分",
  );
});
