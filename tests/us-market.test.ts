import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import UsMarketDashboard from "../src/components/UsMarketDashboard";
import {
  deriveUsMacroJudgement,
  isUsRegularMarketHours,
  mergeUsMarketDashboardData,
  type UsMarketDashboardData,
} from "../src/lib/us-market";

test("weak inflation and payroll surprises produce a dovish judgement", () => {
  const result = deriveUsMacroJudgement({
    cpi: { actual: 3.5, expected: 3.8, previous: 4.2 },
    payroll: { actual: -23, expected: 83, previous: 20 },
    unemployment: { actual: 4.1, expected: null, previous: 4.2 },
  });

  assert.deepEqual(result, {
    stance: "dovish",
    label: "偏鸽",
    employment: "就业降温",
    inflation: "通胀降温",
    policy: "降息压力上升",
    confidence: "full",
    summary: "本月通胀与就业数据均低于市场预期，美联储降息压力上升。",
  });
});

test("missing consensus is disclosed as limited confidence instead of being invented", () => {
  const result = deriveUsMacroJudgement({
    cpi: { actual: 2.8, expected: null, previous: 2.9 },
    payroll: { actual: 105, expected: null, previous: 147 },
    unemployment: { actual: 4.2, expected: null, previous: 4.1 },
  });

  assert.equal(result.stance, "dovish");
  assert.equal(result.confidence, "limited");
  assert.match(result.summary, /一致预期暂缺/);
});

test("US regular-session detection uses New York time across daylight saving time", () => {
  assert.equal(isUsRegularMarketHours(new Date("2026-08-11T13:29:00Z")), false);
  assert.equal(isUsRegularMarketHours(new Date("2026-08-11T13:30:00Z")), true);
  assert.equal(isUsRegularMarketHours(new Date("2026-08-11T20:00:00Z")), true);
  assert.equal(isUsRegularMarketHours(new Date("2026-08-11T20:01:00Z")), false);
  assert.equal(isUsRegularMarketHours(new Date("2026-01-12T14:30:00Z")), true);
  assert.equal(isUsRegularMarketHours(new Date("2026-08-15T15:00:00Z")), false);
});

test("partial live responses retain the last verified macro snapshot", () => {
  const previousMacro = { source: "bls", cpi: { actual: 3.5 } };
  const previous = {
    ok: true,
    ts: 1,
    partial: false,
    stale: true,
    issues: [],
    macro: previousMacro,
    market: null,
  } as UsMarketDashboardData;
  const live = {
    ok: true,
    ts: 2,
    partial: true,
    stale: false,
    issues: ["macro: upstream denied"],
    macro: null,
    market: { source: "eastmoney_delayed", requested: 23, succeeded: 23 },
  } as UsMarketDashboardData;

  const merged = mergeUsMarketDashboardData(previous, live);

  assert.equal(merged.macro, previousMacro);
  assert.equal(merged.market, live.market);
  assert.equal(merged.partial, true);
  assert.equal(merged.stale, true);
});

test("US dashboard renders the macro thermometer, trends, indices, sectors, and companies", () => {
  const point = (date: string, value: number) => ({ date, value });
  const html = renderToStaticMarkup(React.createElement(UsMarketDashboard, {
    initialData: {
      ok: true,
      ts: 1786456000,
      partial: false,
      stale: false,
      issues: [],
      macro: {
        source: "bls",
        source_url: "https://www.bls.gov/developers/api_signature_v2.htm",
        fetched_at: 1786455000,
        cpi: { reference: "2026-06", actual: 3.5, expected: 3.8, previous: 4.2, preliminary: false },
        core_cpi: { reference: "2026-06", actual: 2.6, expected: null, previous: 2.9, preliminary: false },
        payroll: { reference: "2026-07", actual: -23, expected: 80, previous: 20, preliminary: true },
        unemployment: { reference: "2026-07", actual: 4.1, expected: null, previous: 4.2, preliminary: false },
        trends: {
          cpi: [point("2026-05", 4.2), point("2026-06", 3.5)],
          core_cpi: [point("2026-05", 2.9), point("2026-06", 2.6)],
          payroll: [point("2026-06", 20), point("2026-07", -23)],
          unemployment: [point("2026-06", 4.2), point("2026-07", 4.1)],
        },
        consensus: { source: "Test consensus", source_url: "https://example.com", updated_at: "2026-08-07T13:00:00Z" },
      },
      market: {
        source: "eastmoney_delayed",
        source_url: "https://quote.eastmoney.com/usstocklist.html",
        fetched_at: 1786456000,
        quote_ts: 1786455990,
        requested: 3,
        succeeded: 3,
        partial: false,
        indices: [{ symbol: "SPX", name: "标普 500", price: 7000.5, change: 17.2, change_pct: 0.25, quote_ts: 1786455990 }],
        sectors: [{ symbol: "XLK", name: "信息技术", price: 185.9, change: -0.38, change_pct: -0.2, quote_ts: 1786455990 }],
        companies: [{ symbol: "AAPL", name: "苹果", price: 305.9, change: -2.34, change_pct: -0.76, quote_ts: 1786455990 }],
      },
    },
  }));

  assert.match(html, /美国经济温度计/);
  assert.match(html, /偏鸽/);
  assert.match(html, /实际/);
  assert.match(html, /3\.5%/);
  assert.match(html, /最近 12 个月趋势/);
  assert.match(html, /标普 500/);
  assert.match(html, /热门板块/);
  assert.match(html, /苹果/);
});
