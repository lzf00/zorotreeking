import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, summarizeLongTasks, verdict } from "../scripts/tbt-probe.mjs";

test("参数：默认探三个页面，--runs 夹在 1..10，--no-throttle 可关", () => {
  const defaults = parseArgs([]);
  assert.deepEqual(defaults.urls, ["/", "/invest/", "/invest/digest/"]);
  assert.equal(defaults.runs, 2);
  assert.equal(defaults.throttle, true);

  const custom = parseArgs(["--urls", "/ai/,/hike/", "--runs", "5", "--no-throttle"]);
  assert.deepEqual(custom.urls, ["/ai/", "/hike/"]);
  assert.equal(custom.runs, 5);
  assert.equal(custom.throttle, false);

  assert.equal(parseArgs(["--runs", "0"]).runs, 2); // falsy 退回默认
  assert.equal(parseArgs(["--runs", "99"]).runs, 10);
});

test("TBT 只算超过 50ms 的部分，和 Web Vitals 定义一致", () => {
  assert.deepEqual(summarizeLongTasks([]), { count: 0, total: 0, tbt: 0, longest: 0 });
  assert.deepEqual(summarizeLongTasks([{ duration: 40 }, { duration: 120 }, { duration: 260 }]), {
    count: 3,
    total: 420,
    tbt: 280,
    longest: 260,
  });
  // 全是短任务 → TBT 0，但 total 仍然有意义
  const short = summarizeLongTasks([{ duration: 20 }, { duration: 30 }]);
  assert.equal(short.tbt, 0);
  assert.equal(short.total, 50);
  // 非法值不许把统计搞成 NaN
  assert.equal(summarizeLongTasks([{ duration: undefined }, { duration: "x" }, { duration: 60 }]).tbt, 10);
});

test("判定分档：<150 视为无实质阻塞，≥300 才值得修", () => {
  assert.match(verdict(0), /无实质阻塞/);
  assert.match(verdict(149), /无实质阻塞/);
  assert.match(verdict(200), /轻微阻塞/);
  assert.match(verdict(300), /值得修/);
});
