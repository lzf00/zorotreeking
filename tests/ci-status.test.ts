import assert from "node:assert/strict";
import test from "node:test";

import { buildStatus, summarize } from "../scripts/report-ci-status.mjs";

test("成功时挑核心指标当描述", () => {
  const log = ["✓ /", "核心指标：CLS 最差 0.066（/invest/etf/）· LCP 最慢 784 ms（/）", "✓ 运行时自检通过：21 个页面"].join("\n");
  assert.match(summarize(log, "success"), /CLS 最差 0\.066/);
});

test("失败时挑第一条真失败页，而不是总结行", () => {
  const log = ["✓ /", "✗ /invest/", "    pageerror: boom", "✗ 运行时自检失败：1 个页面有问题"].join("\n");
  const description = summarize(log, "failure");
  assert.match(description, /invest/);
  assert.ok(!description.includes("自检失败"), "别把总结行当原因");
});

test("description 会被截断到 GitHub 的 140 字符上限", () => {
  const { payload } = buildStatus({ context: "smoke/runtime", state: "failure", description: "啊".repeat(200), sha: "abc", repo: "o/r" });
  assert.equal(payload.description.length, 140);
});

test("payload 形状符合 statuses API", () => {
  const { url, payload } = buildStatus({ context: "smoke/interactions", state: "success", description: "15/15", sha: "deadbeef", repo: "lzf00/zorotreeking" });
  assert.equal(url, "https://api.github.com/repos/lzf00/zorotreeking/statuses/deadbeef");
  assert.deepEqual(Object.keys(payload).sort(), ["context", "description", "state"]);
});
