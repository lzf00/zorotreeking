import assert from "node:assert/strict";
import test from "node:test";

import { pairWithLighthouse, pairedVerdict, parseArgs, summarizeLongTasks, verdict } from "../scripts/tbt-probe.mjs";

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

const lhr = (url, tbt) => ({ finalUrl: url, audits: { "total-blocking-time": { numericValue: tbt } } });

test("--from-lh 用 pathname 对齐 LH 和实测，取中位数", () => {
  const measured = [{ url: "/invest/", worst: { tbt: 0, count: 0, longest: 0, total: 0 } }];
  const paired = pairWithLighthouse(measured, [
    lhr("https://www.zorotreeking.online/invest/", 600),
    lhr("https://www.zorotreeking.online/invest/", 1000),
    lhr("https://www.zorotreeking.online/other/", 400),
  ]);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].lhTbt, 800); // (600+1000)/2
  assert.equal(paired[0].gap, 800);
  assert.equal(paired[0].phantom, true);
  assert.equal(paired[0].judgement, "LH 的数字是模拟噪声");
});

test("两个数一致时不再喊噪声；没有 LH 数据时按实测分档", () => {
  assert.equal(pairedVerdict(0, 20), "无实质阻塞");
  assert.equal(pairedVerdict(0, 900), "LH 的数字是模拟噪声");
  assert.equal(pairedVerdict(400, 420), "真实阻塞，值得修");
  assert.equal(pairedVerdict(400, null), "真实阻塞，值得修");
});

test("报告缺指标 / 坏数据不会把对比表搞崩", () => {
  const measured = [
    { url: "/a/", worst: { tbt: 0, count: 0, longest: 0, total: 0 } },
    { url: "/b/", worst: { tbt: 0, count: 0, longest: 0, total: 0 } },
  ];
  const paired = pairWithLighthouse(measured, [
    { finalUrl: "/a/" }, // 没有 TBT 指标
    { finalUrl: "", audits: {} },
    { requestedUrl: "/b/", audits: { "total-blocking-time": { numericValue: 380 } } },
  ]);
  assert.equal(paired[0].lhTbt, null);
  assert.equal(paired[0].phantom, false);
  assert.equal(paired[1].lhTbt, 380);
});
