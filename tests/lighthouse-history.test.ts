import assert from "node:assert/strict";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error 纯 ESM 脚本没有类型声明，测试里按结构化数据断言
const { parseScores, pathFromContext, buildTable, median, buildRelativeTable } = await import("../scripts/lighthouse-history.mjs");

test("从 LHCI 的 status 描述里解析四个分数", () => {
  assert.deepEqual(parseScores("Performance: 92, Accessibility: 100, Best Practices: 100, SEO: 100"), {
    Performance: 92,
    Accessibility: 100,
    "Best Practices": 100,
    SEO: 100,
  });
  // 只有警告的描述里没有分数，要返回空对象而不是垃圾键
  assert.deepEqual(parseScores("Passed with 2 warning(s)"), {});
  assert.deepEqual(parseScores(undefined), {});
});

test("status context 还原成站点路径", () => {
  assert.equal(pathFromContext("lhci/url/invest/"), "/invest/");
  assert.equal(pathFromContext("lhci/url/hike/travel/x-2026/"), "/hike/travel/x-2026/");
  assert.equal(pathFromContext("lhci/url/"), "/");
});

test("趋势表：新→旧排列，缺轮次与警告各有标记，并在最新列给出变化", () => {
  const audits = [
    { sha: "newnew1", date: "2026-11-18T12:14:00Z", urls: {
      "/": { state: "success", Performance: 93 },
      "/invest/": { state: "success", Performance: 80 },
      "/tag/photo/": { state: "success", description: "Passed with 2 warning(s)" },
    } },
    { sha: "oldold1", date: "2026-11-18T10:57:00Z", urls: {
      "/": { state: "success", Performance: 92 },
      "/invest/": { state: "success", Performance: 93 },
    } },
    { sha: "canceld", date: "2026-11-18T09:00:00Z", urls: {
      "/": { state: "success", Performance: 99 },
      "/invest/": { state: "failure", description: "Failed with 1 error(s)" },
    } },
  ];
  const table = buildTable(audits);
  const rows = table.split("\n");

  assert.match(rows[0], /\| URL\s+\| newnew1 11-18 12:14 \| oldold1 11-18 10:57 \| canceld 11-18 09:00 \|/);
  // 涨了 1 分
  assert.match(table, /`\/`\s+\| 93 ↑1\s+\| 92\s+\| 99/);
  // 跌了 13 分
  assert.match(table, /`\/invest\/`\s+\| 80 ↓13\s+\| 93\s+\| ✗f/);
  // 这一轮没有该 URL 的数据
  assert.match(table, /`\/tag\/photo\/`\s+\| ⚠\s+\| —\s+\| —/);
});

test("趋势表：只有一轮时不报错，也不画箭头", () => {
  const table = buildTable([
    { sha: "onlyone", date: "2026-11-18T12:00:00Z", urls: { "/": { state: "success", Performance: 88 } } },
  ]);
  assert.match(table, /`\/`\s+\| 88\s+\|/);
  assert.doesNotMatch(table, /↑|↓/);
});

test("中位数：奇数取中间、偶数取平均、空数组返回 null", () => {
  assert.equal(median([98, 94, 96]), 96);
  assert.equal(median([98, 94, 96, 90]), 95);
  assert.equal(median([]), null);
  assert.equal(median([undefined, 92]), 92);
});

test("相对中位数表：跑者整轮漂移会被减掉，只剩页面自己的结构差距", () => {
  // 真实数据：c3f5f6c 这一轮 15 个 URL 都在 93–98，`/invest/` 与 `/invest/digest/` 是唯二落后项
  const audits = [{
    sha: "c3f5f6c",
    date: "2026-11-18T19:51:00Z",
    urls: {
      "/": { state: "success", Performance: 98 },
      "/ai/": { state: "success", Performance: 98 },
      "/invest/": { state: "success", Performance: 94 },
      "/invest/digest/": { state: "success", Performance: 93 },
    },
  }];
  const table = buildRelativeTable(audits);
  // 中位数 (98+98+94+93)/2… 四个数取中间两个的平均 = 96
  assert.match(table, /\| 本轮中位数 \|/);
  assert.match(table, /`\/invest\/digest\/`\s*\| 93\s*\| 96\s*\| -3/);
  assert.match(table, /`\/`\s*\| 98\s*\| 96\s*\| \+2/);
  assert.match(buildRelativeTable([]), /没有可用的分数/);
});
