import assert from "node:assert/strict";
import test from "node:test";

import { buildStatuses, contextFor } from "../scripts/lighthouse-statuses.mjs";

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
  assert.equal(statuses[1].description, "93 分 · LCP 0.84s · TBT 633ms · CLS 0.000");
  assert.equal(statuses[1].target_url, "https://github.com/o/r/actions/runs/1");
});

test("性能低于 0.80 记 failure，缺分数也记 failure（不能假装成功）", () => {
  const [low, missing, ok] = buildStatuses([
    { url: "/a/", perf: 0.79, lcp: 2000, tbt: 900 },
    { url: "/b/", perf: NaN, lcp: NaN, tbt: NaN },
    { url: "/c/", perf: 0.8, lcp: 1000, tbt: 0 },
  ]);
  assert.equal(low.state, "failure");
  assert.equal(missing.state, "failure");
  assert.equal(missing.description.startsWith("— 分"), true);
  // 正好 0.80 算过（和 assert 的 warn 阈值一致）
  assert.equal(ok.state, "success");
});

test("描述长度不超过 GitHub 的 140 字符上限", () => {
  const [status] = buildStatuses([{ url: "/x/", perf: 0.5, lcp: 123456, tbt: 123456, cls: 0.123456 }]);
  assert.ok(status.description.length <= 140, status.description);
});
