/**
 * 内部断档检测（第 138 轮）。
 *
 * 真实事件：2026-11-19、11-20 两天，AI 日报与投资日报**同时没有产出**，11-21 又恢复。
 * 旧看门狗只看"最新一篇是哪天"，看到最新是昨天就判 ✅ —— 流水线连漏两天也能一直闭嘴。
 *
 * 这组测试锁住三件事：能发现断档、分级合理（近的算失败、远的只记录）、
 * 不把"周末没有复盘"误报成漏。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { internalGaps, summarizeFreshness } from "../scripts/check-freshness.mjs";

const digestDays = (...dates: string[]) => dates.flatMap((date) => [`digest-${date}.zh.mdx`, `digest-${date}.en.mdx`]);

test("连续漏两天、最后一天恢复：必须报出漏掉的具体日期", () => {
  const gaps = internalGaps(
    { "invest-digest": digestDays("2026-11-17", "2026-11-18", "2026-11-21") },
    { today: "2026-11-22", days: 7, recentDays: 2 },
  );
  // 只看 11-19 之后：更早的日期在夹具里本来就没有，不属于这条断言的范围
  assert.deepEqual(
    gaps.filter((gap) => gap.stream === "invest-digest" && gap.date >= "2026-11-19").map((gap) => `${gap.date}:${gap.level}`),
    ["2026-11-20:fail", "2026-11-19:warn"],
    "11-20 还来得及补（fail）；11-19 已经错过（warn，仅记录）",
  );
});

test("今天还没有产物不算断档（流水线早上才跑）", () => {
  const gaps = internalGaps(
    { "ai-digest": digestDays("2026-11-19", "2026-11-20", "2026-11-21") },
    { today: "2026-11-22", days: 7 },
  );
  assert.equal(gaps.some((gap) => gap.date === "2026-11-22"), false);
});

test("比最新一篇更近的日期不算断档（那些天还没到该有的日子）", () => {
  const gaps = internalGaps(
    { "ai-digest": digestDays("2026-11-20", "2026-11-21", "2026-11-22") },
    { today: "2026-11-22", days: 7 },
  );
  assert.deepEqual(gaps.filter((gap) => gap.date >= "2026-11-20"), [], "最新一篇之前的日期才可能断档");
});

test("周末不产复盘，不能报成断档", () => {
  // 2026-11-21 是周六、11-22 是周日；复盘最新是周五 11-20
  const gaps = internalGaps(
    { "invest-recap": ["market-recap-2026-11-18.zh.mdx", "market-recap-2026-11-19.zh.mdx", "market-recap-2026-11-20.zh.mdx"] },
    { today: "2026-11-22", days: 7 },
  );
  assert.deepEqual(gaps.filter((gap) => gap.date >= "2026-11-19"), [], "周末两天不能被报成断档");
});

test("复盘在周末不该显示落后：周五的复盘在周六看是新的", () => {
  const { rows, ok } = summarizeFreshness(
    {
      "invest-recap": ["market-recap-2026-11-20.zh.mdx", "market-recap-2026-11-20.en.mdx"],
      "ai-digest": digestDays("2026-11-20", "2026-11-21"),
      "invest-digest": digestDays("2026-11-20", "2026-11-21"),
    },
    { today: "2026-11-22", maxAgeDays: 2 },
  );
  const recap = rows.find((row: any) => row.id === "invest-recap");
  assert.equal(recap.age, 0, "按交易日算，周六看到周五的复盘 = 0 天");
  assert.equal(recap.level, "ok");
  assert.equal(ok, true);
});

test("断档会让整体判定为不健康（failingGaps 非空）", () => {
  const summary = summarizeFreshness(
    {
      "ai-digest": digestDays("2026-11-18", "2026-11-21"),
      "invest-digest": digestDays("2026-11-18", "2026-11-21"),
      "invest-recap": ["market-recap-2026-11-20.zh.mdx"],
    },
    { today: "2026-11-22", maxAgeDays: 2 },
  );
  assert.equal(summary.ok, false);
  assert.ok(summary.failingGaps.some((gap: any) => gap.date === "2026-11-20"));
});
