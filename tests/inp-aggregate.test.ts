/**
 * 交互采样多轮汇总（第 129 轮）。
 *
 * 同一构建、同一台机器上，相册页「点开灯箱」实测会跳：16 / 184 / 576 ms。
 * 单次采样定不了性；取最小值又太乐观（第二遍解码结果已在缓存里，用户首次访问不是这个体验）。
 * 所以保留首轮（冷启动）+ 最快 + 中位数，判定看中位数。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateRounds, median, worstOf } from "../scripts/lib/inp-aggregate.mjs";

test("中位数：奇数取中间，偶数取均值取整", () => {
  assert.equal(median([576, 16, 184]), 184);
  assert.equal(median([10, 20]), 15);
  assert.equal(median([]), Number.NaN);
});

test("汇总保留首轮、最快与中位数", () => {
  const rows = aggregateRounds([
    [{ action: "点开灯箱", ms: 576 }],
    [{ action: "点开灯箱", ms: 16 }],
    [{ action: "点开灯箱", ms: 184 }],
  ]);
  const row = rows.get("点开灯箱")!;
  assert.equal(row.first, 576, "首轮是冷启动，要留着");
  assert.equal(row.min, 16);
  assert.equal(row.median, 184);
  assert.equal(row.samples.length, 3);
});

test("任一轮没打开（skipped）就不参与评优", () => {
  const rows = aggregateRounds([
    [{ action: "点开灯箱", ms: 0, skipped: true }],
    [{ action: "点开灯箱", ms: 300 }],
  ]);
  const row = rows.get("点开灯箱")!;
  assert.equal(row.skipped, true);
  assert.ok(Number.isNaN(row.median), "skipped 的中位数应为 NaN，不能当成 0 ms 优等生");
  assert.equal(worstOf([...rows.values()]), null);
});

test("worstOf 忽略 skipped，挑中位数最大的动作", () => {
  const rows = aggregateRounds([
    [{ action: "切换主题", ms: 104 }, { action: "点开灯箱", ms: 576 }],
    [{ action: "切换主题", ms: 16 }, { action: "点开灯箱", ms: 16 }],
  ]);
  const worst = worstOf([...rows.values()])!;
  // 切换主题中位 (104+16)/2 = 60；灯箱中位 (576+16)/2 = 296 → 灯箱最慢
  assert.equal(worst.action, "点开灯箱");
  assert.equal(worst.median, 296);
});
