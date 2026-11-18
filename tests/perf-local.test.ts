import assert from "node:assert/strict";
import test from "node:test";

import { median, parseArgs, spread, summarize } from "../scripts/perf-local.mjs";

test("默认 URL 与 --urls/--runs 覆盖", () => {
  assert.deepEqual(parseArgs([]).urls, ["/", "/invest/", "/explore/", "/photo/"]);
  const parsed = parseArgs(["--urls", "/ai/,/invest/", "--runs", "3", "--json"]);
  assert.deepEqual(parsed.urls, ["/ai/", "/invest/"]);
  assert.equal(parsed.runs, 3);
  assert.equal(parsed.json, true);
});

test("默认预热文件缓存，--no-warmup 可关", () => {
  assert.equal(parseArgs([]).warmup, true);
  assert.equal(parseArgs(["--no-warmup"]).warmup, false);
});

test("--runs 被夹在 1..10，坏值退回默认 2", () => {
  // 0 是 falsy，按「没填」处理，退回默认 2；负数夹到 1
  assert.equal(parseArgs(["--runs", "0"]).runs, 2);
  assert.equal(parseArgs(["--runs", "-3"]).runs, 1);
  assert.equal(parseArgs(["--runs", "99"]).runs, 10);
  assert.equal(parseArgs(["--runs", "abc"]).runs, 2);
});

test("中位数：奇数取中间、偶数取中间两个的均值", () => {
  assert.equal(median([95, 89, 92]), 92);
  assert.equal(median([89, 95]), 92);
  assert.equal(median([]), null);
  assert.equal(median([97]), 97);
});

test("极差：max − min；不足两个样本算 0", () => {
  assert.equal(spread([70, 84, 99]), 29);
  assert.equal(spread([92, 92]), 0);
  assert.equal(spread([97]), 0);
  assert.equal(spread([]), 0);
});

test("单次运行一律算抖（同样跑两次也能知道噪声有多大）", () => {
  const summary = summarize("/invest/digest/", [{ perf: 90, fcp: 700, lcp: 800, tbt: 0 }]);
  assert.equal(summary.perf, 90);
  assert.equal(summary.noisy, true);
  assert.equal(summary.perfSpread, 0);
});

test("性能极差 ≥5 或 TBT 极差 ≥150ms 判为抖", () => {
  const stable = summarize("/ai/", [
    { perf: 100, fcp: 480, lcp: 540, tbt: 0 },
    { perf: 99, fcp: 500, lcp: 560, tbt: 20 },
    { perf: 100, fcp: 490, lcp: 550, tbt: 0 },
  ]);
  assert.equal(stable.noisy, false);
  assert.equal(stable.perf, 100);
  assert.equal(stable.perfSpread, 1);

  const perfNoise = summarize("/invest/digest/", [
    { perf: 70, fcp: 900, lcp: 1000, tbt: 600 },
    { perf: 84, fcp: 800, lcp: 900, tbt: 400 },
    { perf: 99, fcp: 700, lcp: 800, tbt: 0 },
  ]);
  assert.equal(perfNoise.noisy, true);
  assert.equal(perfNoise.perf, 84);
  assert.equal(perfNoise.perfSpread, 29);

  // 分数极差只有 3，但 TBT 从 0 跳到 300——同样是软件光栅噪声
  const tbtNoise = summarize("/", [
    { perf: 72, fcp: 700, lcp: 900, tbt: 964 },
    { perf: 73, fcp: 720, lcp: 910, tbt: 0 },
  ]);
  assert.equal(tbtNoise.noisy, true);
  assert.equal(tbtNoise.perfSpread, 1);
  assert.equal(tbtNoise.tbtSpread, 964);
});
