import assert from "node:assert/strict";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore 脚本是 .mjs（CI 里直接 node 运行），这里拿到它的导出做纯函数级校验
const { median, pickRun, renderTable, summarize } = await import("../scripts/lighthouse-summary.mjs");

const makeLhr = (url: string, scores: Record<string, number | undefined>, metrics: Record<string, number> = {}) => ({
  finalUrl: url,
  requestedUrl: url,
  categories: {
    performance: { score: scores.perf },
    accessibility: { score: scores.a11y },
    "best-practices": { score: scores.bp },
    seo: { score: scores.seo },
  },
  audits: Object.fromEntries(
    Object.entries({ ...metrics }).map(([id, value]) => [id, { numericValue: value }]),
  ),
});

test("median 取中位数，过滤掉 NaN/undefined", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([Number.NaN, undefined, 0.9]), 0.9);
  assert.ok(Number.isNaN(median([])));
});

test("pickRun 只保留报告需要的字段", () => {
  const run = pickRun(
    makeLhr("https://x/a/", { perf: 0.9, a11y: 1, bp: 1, seo: 1 }, {
      "largest-contentful-paint": 1234,
      "total-blocking-time": 56,
      "cumulative-layout-shift": 0.01,
      "speed-index": 1500,
    }),
  );
  assert.equal(run.url, "https://x/a/");
  assert.equal(run.perf, 0.9);
  assert.equal(run.lcp, 1234);
  assert.equal(run.tbt, 56);
});

test("summarize 按 URL 聚合、取中位、最差的排前面", () => {
  const rows = summarize([
    makeLhr("https://x/", { perf: 0.99, a11y: 1, bp: 1, seo: 1 }),
    makeLhr("https://x/", { perf: 0.75, a11y: 1, bp: 1, seo: 1 }),
    makeLhr("https://x/", { perf: 0.86, a11y: 1, bp: 1, seo: 1 }),
    makeLhr("https://x/about/", { perf: 1, a11y: 1, bp: 1, seo: 1 }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, "https://x/");
  assert.equal(rows[0].perf, 0.86);
  assert.equal(rows[0].runs, 3);
  assert.equal(rows[1].url, "https://x/about/");
});

test("renderTable 输出 markdown，缺失指标显示 —", () => {
  const table = renderTable(summarize([makeLhr("https://x/invest/digest/", { perf: 0.82, a11y: 1, bp: 1, seo: 1 })]));
  assert.match(table, /\| 页面 \| perf \| a11y \|/);
  assert.match(table, /`\/invest\/digest\/`/);
  assert.match(table, /\| 0\.82 \|/);
  assert.match(table, /—/); // 没有 metrics 时 LCP/TBT 等为 —
});

test("没有报告时给出可读提示而不是崩溃", () => {
  assert.match(renderTable([], { title: "空" }), /没有找到任何报告/);
});
