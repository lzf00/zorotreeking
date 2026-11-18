import assert from "node:assert/strict";
import test from "node:test";

import { median, parseArgs } from "../scripts/perf-local.mjs";

test("默认 URL 与 --urls/--runs 覆盖", () => {
  assert.deepEqual(parseArgs([]).urls, ["/", "/invest/", "/explore/", "/photo/"]);
  const parsed = parseArgs(["--urls", "/ai/,/invest/", "--runs", "3", "--json"]);
  assert.deepEqual(parsed.urls, ["/ai/", "/invest/"]);
  assert.equal(parsed.runs, 3);
  assert.equal(parsed.json, true);
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
