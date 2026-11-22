/**
 * BLS → 宏观块的纯计算（第 136 轮）。
 *
 * 页面首屏那三个词（就业/通胀/政策）是这些数字推出来的，算错就是**编造经济结论**，
 * 所以这一层用固定样本单测：同比要按 12 个月前的同月算、非农要按月水平值做差、
 * 中间断月（2025-10 BLS 因政府停摆没发布 CPI）不能把两个月合计算成一个月。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeUsMacro,
  monthOverMonth,
  normalizeSeries,
  yearOverYear,
} from "../scripts/lib/us-macro-compute.mjs";

const row = (year: string, month: number, value: number, preliminary = false) => ({
  year,
  period: `M${String(month).padStart(2, "0")}`,
  value: String(value),
  footnotes: preliminary ? [{ code: "P", text: "Preliminary" }] : [{}],
});

/** 造一段连续月度指数序列（从 2024-01 起 n 个月）。 */
function series(startYear: number, startMonth: number, values: number[], preliminaryLast = false) {
  return values.map((value, index) => {
    const total = startMonth - 1 + index;
    const year = String(startYear + Math.floor(total / 12));
    const month = (total % 12) + 1;
    return row(year, month, value, preliminaryLast && index === values.length - 1);
  });
}

test("normalizeSeries：丢掉年均值 M13，按时间升序", () => {
  const points = normalizeSeries([
    row("2026", 10, 337.511),
    { year: "2026", period: "M13", value: "330.0" },
    row("2026", 9, 336.94),
  ]);
  assert.deepEqual(points.map((p) => p.ym), ["2026-09", "2026-10"]);
});

test("yearOverYear：按 12 个月前同月算，缺基期的月份直接跳过", () => {
  const points = normalizeSeries([...series(2025, 1, [100, 101, 102]), ...series(2026, 1, [110, 121])]);
  const yoy = yearOverYear(points);
  assert.deepEqual(yoy.map((p) => p.date), ["2026-01", "2026-02"]);
  assert.equal(yoy[0].value, 10); // 110 / 100 - 1
  assert.equal(yoy[1].value, 19.8); // 121 / 101 - 1
});

test("yearOverYear：2025-10 缺基期时，2026-10 不硬算（BLS 停摆真实场景）", () => {
  // 2025 年缺 10 月（BLS 停摆时真实发生过），2026 年 10 月的基期因此不存在
  const beforeGap = series(2025, 1, [100, 101, 102, 103, 104, 105, 106, 107, 108]);
  const afterGap = series(2025, 11, [110, 111]);
  const points = normalizeSeries([...beforeGap, ...afterGap, ...series(2026, 1, [120, 121, 122, 123, 124, 125, 126, 127, 128, 129])]);
  const yoy = yearOverYear(points);
  const oct = yoy.find((p) => p.date === "2026-10");
  assert.equal(oct, undefined, "基期缺失的月份不能出现在同比序列里");
  assert.equal(yoy.at(-1)?.date, "2026-09");
});

test("monthOverMonth：相邻月做差（千人），断月跳过而不是合并", () => {
  const points = normalizeSeries([row("2026", 8, 159_000), row("2026", 9, 159_165), { year: "2026", period: "M11", value: "159_500" }]);
  const mom = monthOverMonth(points);
  assert.deepEqual(mom.map((p) => [p.date, p.value]), [["2026-09", 165]]);
});

test("computeUsMacro：四个序列齐全时给出最新两期 + 13 个月趋势", () => {
  const cpi = series(2025, 1, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113]);
  const cpiPrevYear = series(2024, 1, [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]);
  const core = series(2025, 1, [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
  const corePrev = series(2024, 1, [96, 96, 96, 96, 96, 96, 96, 96, 96, 96, 96, 96]);
  const payroll = series(2025, 1, [159_000, 159_100, 159_200, 159_300, 159_400, 159_500, 159_600, 159_700, 159_800, 159_900, 160_000, 160_100, 160_200, 160_400]);
  const unemployment = series(2025, 1, [4.1, 4.1, 4.2, 4.2, 4.3, 4.2, 4.1, 4.1, 4.0, 4.1, 4.1, 4.2, 4.2, 4.1]);

  const result = computeUsMacro({ cpi: [...cpiPrevYear, ...cpi], core_cpi: [...corePrev, ...core], payroll, unemployment }, { fetchedAt: 1_800_000_000 });
  assert.equal(result.ok, true);
  const macro = result.macro;
  assert.equal(macro.cpi.reference, "2026-02");
  assert.equal(macro.cpi.previous != null, true);
  assert.equal(macro.payroll.actual, 200, "非农月增量 = 160400 - 160200");
  assert.equal(macro.unemployment.actual, 4.1);
  assert.equal(macro.stale, false);
  assert.equal(macro.trends.cpi.length, 13);
  assert.equal(macro.trends.payroll.length, 13);
  assert.equal(macro.cpi.expected, null, "没有一致预期来源时留空，不写假数");
  // 失业率序列用的是 ym 字段，曾经把 reference 写成 latest.date → 页面参考期变成空白
  assert.equal(macro.unemployment.reference, "2026-02");
});

test("computeUsMacro：任一序列不足两期就整体失败（不写半截数据）", () => {
  const cpi = series(2025, 1, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112]);
  const result = computeUsMacro({ cpi, core_cpi: cpi, payroll: cpi, unemployment: [row("2026", 10, 4.1)] });
  assert.equal(result.ok, false);
  assert.match(result.error, /unemployment/);
});

// ── 第 160 轮：一致预期过了保质期就作废，不能拿三个月前的预期算"偏鹰/偏鸽" ──────────

const FIXTURE = (() => {
  const cpi = series(2025, 1, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113]);
  const cpiPrevYear = series(2024, 1, [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106]);
  const core = series(2025, 1, Array(14).fill(100));
  const corePrev = series(2024, 1, Array(12).fill(96));
  const payroll = series(2025, 1, [159_000, 159_100, 159_200, 159_300, 159_400, 159_500, 159_600, 159_700, 159_800, 159_900, 160_000, 160_100, 160_200, 160_400]);
  const unemployment = series(2025, 1, [4.1, 4.1, 4.2, 4.2, 4.3, 4.2, 4.1, 4.1, 4.0, 4.1, 4.1, 4.2, 4.2, 4.1]);
  return { cpi: [...cpiPrevYear, ...cpi], core_cpi: [...corePrev, ...core], payroll, unemployment };
})();

test("一致预期新鲜就把 expected 带进各指标", () => {
  const fetchedAt = Date.parse("2026-11-21T00:00:00Z") / 1000;
  const result = computeUsMacro(FIXTURE, {
    fetchedAt,
    carryExpected: {
      cpi: { reference: "2026-02", actual: 3.7, expected: 3.9 },
      consensus: { source: "TE", updated_at: "2026-11-10T00:00:00Z" },
      consensusMatches: true,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.macro.cpi.expected, 3.9);
  assert.ok(result.macro.consensus, "新鲜的一致预期要保留");
});

test("一致预期过期（106 天）就整体作废，判断退回前值", () => {
  const fetchedAt = Date.parse("2026-11-21T00:00:00Z") / 1000;
  const result = computeUsMacro(FIXTURE, {
    fetchedAt,
    carryExpected: {
      cpi: { reference: "2026-02", actual: 3.7, expected: 3.9 },
      consensus: { source: "TE", updated_at: "2026-08-07T13:00:00Z" },
      consensusMatches: true,
    },
  });
  assert.equal(result.macro.cpi.expected, null, "过期预期不能继续参与计算");
  assert.equal(result.macro.consensus, null, "也不该再挂在页面上");
});

test("保质期可覆盖：45 天是默认，可显式放宽", () => {
  const fetchedAt = Date.parse("2026-11-21T00:00:00Z") / 1000;
  const carryExpected = {
    cpi: { reference: "2026-02", actual: 3.7, expected: 3.9 },
    consensus: { source: "TE", updated_at: "2026-10-20T00:00:00Z" }, // 32 天
    consensusMatches: true,
  };
  assert.equal(computeUsMacro(FIXTURE, { fetchedAt, carryExpected }).macro.cpi.expected, 3.9);
  assert.equal(
    computeUsMacro(FIXTURE, { fetchedAt, carryExpected, maxConsensusAgeDays: 20 }).macro.cpi.expected,
    null,
    "阈值收紧后同样过期",
  );
});

test("没有 updated_at 的一致预期不可信，直接作废", () => {
  const fetchedAt = Date.parse("2026-11-21T00:00:00Z") / 1000;
  const result = computeUsMacro(FIXTURE, {
    fetchedAt,
    carryExpected: { cpi: { reference: "2026-02", expected: 3.9 }, consensus: { source: "TE" }, consensusMatches: true },
  });
  assert.equal(result.macro.cpi.expected, null);
  assert.equal(result.macro.consensus, null);
});
