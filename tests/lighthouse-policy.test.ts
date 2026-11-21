/**
 * 逐 URL 的红叉只能来自 **error 级**断言（第 130 轮）。
 *
 * 起因：`perf/hike/travel/ali-grand-loop-lhasa-return-2026/` 在 commit 列表上挂着 failure（71 分），
 * 但同一份报告的 `lhci/url/...` 写「Passed with 2 warning(s)」、`perf/audited` 也是 success。
 * 三条状态互相矛盾——因为状态脚本自己硬编码了「perf < 0.8 就是 failure」，
 * 而 `.lighthouserc.json` 里 `categories:performance` 是 warn（分数受 runner 负载影响，只该告警）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { evaluateRow, loadPolicy, normalizeAssertions } from "../scripts/lighthouse-policy.mjs";

const POLICY = loadPolicy();

test("性能分只告警：71 分的页面不该挂红叉", () => {
  const verdict = evaluateRow(
    { url: "https://x/hike/travel/a/", perf: 0.71, a11y: 1, seo: 1, bp: 0.96, lcp: 2660, tbt: 39, cls: 0.011 },
    POLICY,
  );
  assert.equal(verdict.state, "success");
  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.warnings.length, 1, "71 分应记录成告警");
});

test("LCP 超 3.5 s 是硬拦（这轮之前唯一真失败项）", () => {
  const verdict = evaluateRow({ url: "https://x/", perf: 0.92, a11y: 1, seo: 1, bp: 1, lcp: 3820, cls: 0.01 }, POLICY);
  assert.equal(verdict.state, "failure");
  assert.match(verdict.failures.join(), /largest-contentful-paint/);
});

test("CLS 超 0.1 与 a11y 低于 0.9 都算硬拦", () => {
  assert.equal(evaluateRow({ perf: 1, a11y: 1, seo: 1, bp: 1, lcp: 1000, cls: 0.16 }, POLICY).state, "failure");
  assert.equal(evaluateRow({ perf: 1, a11y: 0.85, seo: 1, bp: 1, lcp: 1000, cls: 0.01 }, POLICY).state, "failure");
});

test("策略确实来自 .lighthouserc.json（配置改了测试会跟着变）", async () => {
  const config = JSON.parse(await readFile(new URL("../.lighthouserc.json", import.meta.url), "utf8"));
  const assertions = config.ci.assert.assertions;
  assert.equal(assertions["categories:performance"][0], "warn");
  assert.equal(assertions["largest-contentful-paint"][0], "error");
  assert.equal(POLICY["categories:performance"].level, "warn");
  assert.equal(POLICY["categories:performance"].minScore, assertions["categories:performance"][1].minScore);
  assert.equal(POLICY["largest-contentful-paint"].maxNumericValue, assertions["largest-contentful-paint"][1].maxNumericValue);
});

test("normalizeAssertions 同时吃字符串与数组两种写法", () => {
  const rules = normalizeAssertions({ "color-contrast": "error", "categories:seo": ["error", { minScore: 0.95 }] });
  assert.equal(rules["color-contrast"].level, "error");
  assert.equal(rules["categories:seo"].minScore, 0.95);
});
