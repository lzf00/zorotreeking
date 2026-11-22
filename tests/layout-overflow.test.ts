/**
 * 横向溢出守卫（第 164 轮）。
 *
 * CLS 测不到"页面比屏幕宽"。手机上多出几像素，用户看到的就是整页能左右晃 ——
 * axe 无障碍扫描和 vitals 都不会报，只有真机才看得见。实测基线（18 个模板 × 390/1280）
 * 全部 0px，所以这里把"超过 1px 就是坏了"钉死。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { describeOverflow, overflowOf } from "../scripts/lib/overflow.mjs";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("整齐的页面不算溢出（含亚像素取整误差）", () => {
  assert.deepEqual(overflowOf({ scrollWidth: 390, clientWidth: 390 }), { overflow: 0, ok: true });
  assert.equal(overflowOf({ scrollWidth: 391, clientWidth: 390 }).ok, true, "1px 内是取整误差");
  assert.deepEqual(overflowOf({ scrollWidth: 394, clientWidth: 390 }), { overflow: 4, ok: false });
});

test("缺失/异常值不能炸", () => {
  assert.deepEqual(overflowOf({}), { overflow: 0, ok: true });
  assert.deepEqual(overflowOf(null as never), { overflow: 0, ok: true });
});

test("结论文案要指出最宽的元素，否则只知道超了几像素没法查", () => {
  assert.equal(describeOverflow({ overflow: 0 }), null);
  const message = describeOverflow({ overflow: 12, worst: { over: 12, tag: "code", cls: "hljs" } });
  assert.match(message ?? "", /横向溢出 \+12px/);
  assert.match(message ?? "", /<code>/);
  assert.match(message ?? "", /超出 12px/);
});

test("check-runtime 真的量了 scrollWidth 并把它当问题", async () => {
  const script = await read("scripts/check-runtime.mjs");
  assert.match(script, /doc\.scrollWidth - doc\.clientWidth/, "要量整页宽度差");
  assert.match(script, /overflowOf\(layout\)/, "用同一套判定");
  assert.match(script, /issues\.push\(message/, "溢出要算失败，不能只打印");
  // 手机模式必须覆盖：桌面 1280 根本看不出这个问题
  assert.match(script, /--mobile/);
});
