import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as chinaMarket from "../src/lib/china-market";
import { formatChinaMarketTime, isChinaATradingHours } from "../src/lib/china-market";
import { classifyLaggingSectors } from "../src/lib/market-quality";
import {
  formatSignedCurrency,
  normalizePublishedFundQuote,
  summarizePortfolioValuation,
  valueFundPosition,
} from "../src/lib/portfolio-valuation";

test("China market hours do not depend on the visitor's local timezone", () => {
  assert.equal(isChinaATradingHours(new Date("2026-08-03T01:30:00Z")), true);
  assert.equal(isChinaATradingHours(new Date("2026-08-03T04:00:00Z")), false);
  assert.equal(isChinaATradingHours(new Date("2026-08-03T05:00:00Z")), true);
  assert.equal(isChinaATradingHours(new Date("2026-08-02T02:00:00Z")), false);
  assert.equal(
    formatChinaMarketTime(new Date("2026-08-03T01:30:00Z").getTime() / 1000),
    "09:30:00",
  );
});

test("published fund NAV keeps refreshing after market close until the evening cutoff", () => {
  const refreshWindow = (chinaMarket as typeof chinaMarket & {
    isFundNavRefreshWindow?: (date: Date) => boolean;
  }).isFundNavRefreshWindow;

  assert.equal(typeof refreshWindow, "function");
  assert.equal(refreshWindow?.(new Date("2026-08-11T08:30:00Z")), true); // 北京 16:30
  assert.equal(refreshWindow?.(new Date("2026-08-11T14:30:00Z")), true); // 北京 22:30
  assert.equal(refreshWindow?.(new Date("2026-08-11T14:31:00Z")), false);
  assert.equal(refreshWindow?.(new Date("2026-08-15T08:30:00Z")), false); // 周六
});

test("partial fund quotes do not count missing positions as a 100% loss", () => {
  const summary = summarizePortfolioValuation([
    { costValue: 100, marketValue: 110, todayPnl: 2 },
    { costValue: 200, marketValue: null, todayPnl: null },
  ]);

  assert.deepEqual(summary, {
    totalCost: 300,
    valuedCost: 100,
    totalMarketValue: 110,
    totalPnl: 10,
    totalPnlPct: 10,
    todayPnl: 2,
    todayPnlPct: (2 / 108) * 100,
    valuedCount: 1,
    todayCount: 1,
  });
});

test("empty quote sets keep portfolio totals explicitly unavailable", () => {
  const summary = summarizePortfolioValuation([
    { costValue: 100, marketValue: null, todayPnl: null },
  ]);

  assert.equal(summary.totalCost, 100);
  assert.equal(summary.valuedCount, 0);
  assert.equal(summary.totalPnlPct, null);
  assert.equal(summary.todayPnlPct, null);
});

test("published fund valuation never substitutes cumulative NAV for unit NAV", () => {
  assert.deepEqual(
    normalizePublishedFundQuote(
      {
        code: "012414",
        unit_nav: 0.5752,
        unit_nav_date: "2026-08-10",
        previous_unit_nav: 0.5614,
        previous_unit_nav_date: "2026-08-07",
        cumulative_nav: 0.6602,
        day_pct: 2.46,
        source: "eastmoney_fundmob",
        nav: 9.9999,
        nav_date: "2026-08-01",
        est_nav: 8.8888,
        est_pct: 2.46,
        est_time: null,
        ok: true,
      },
      "012414",
    ),
    {
      code: "012414",
      nav: 0.5752,
      navDate: "2026-08-10",
      previousNav: 0.5614,
      previousNavDate: "2026-08-07",
      cumulativeNav: 0.6602,
      dayPct: 2.46,
      source: "eastmoney_fundmob",
      basis: "published_nav",
    },
  );
});

test("published fund valuation rejects a response for a different share class", () => {
  assert.equal(
    normalizePublishedFundQuote(
      {
        code: "161226",
        nav: 1.7624,
        nav_date: "2026-08-10",
        est_pct: 2.53,
        ok: true,
      },
      "019005",
    ),
    null,
  );
});

test("published fund quote preserves nonfatal upstream quality warnings", () => {
  const result = normalizePublishedFundQuote(
    {
      code: "006551",
      unit_nav: 3.7462,
      unit_nav_date: "2026-08-10",
      previous_unit_nav: 3.7197,
      previous_unit_nav_date: "2026-08-07",
      cumulative_nav: 3.7462,
      day_pct: 0.7124,
      source: "eastmoney_fundmob",
      quality_issues: ["nav_date_regression"],
      stale: true,
      ok: true,
    },
    "006551",
  );

  assert.deepEqual(result?.qualityIssues, ["nav_date_regression"]);
  assert.equal(result?.stale, true);
});

test("fund position PnL uses the published NAV and its published NAV date", () => {
  const result = valueFundPosition(
    { shares: 5000, costAvg: 0.65 },
    {
      code: "012414",
      nav: 0.5752,
      navDate: "2026-08-10",
      previousNav: 0.5614,
      previousNavDate: "2026-08-07",
      cumulativeNav: 0.6602,
      dayPct: 2.46,
      source: "eastmoney_fundmob",
      basis: "published_nav",
    },
  );

  assert.equal(result.marketValue, 2876);
  assert.equal(result.costValue, 3250);
  assert.ok(Math.abs(result.dayPnl! - 69) < 1e-10);
  assert.equal(result.navDate, "2026-08-10");
});

test("simulation supports an explicit subscription fee without changing total cash cost", () => {
  const result = valueFundPosition(
    { shares: 0, costAvg: 2, initialCapital: 10000, subscriptionFeePct: 1.5 },
    {
      code: "006551",
      nav: 2.2,
      navDate: "2026-08-10",
      previousNav: 2.1,
      previousNavDate: "2026-08-07",
      cumulativeNav: 2.2,
      dayPct: 4.76,
      source: "eastmoney_fundmob",
      basis: "published_nav",
    },
    "simulation",
  );

  assert.ok(Math.abs(result.valuedShares! - 4926.108374384237) < 1e-10);
  assert.equal(result.costValue, 10000);
  assert.ok(Math.abs(result.marketValue! - 10837.438423645322) < 1e-10);
  assert.ok(Math.abs(result.dayPnl! - 492.6108374384237) < 1e-10);
});

test("placeholder holdings expose published NAV but never fake account valuation", () => {
  const result = valueFundPosition(
    { shares: 8000, costAvg: 1.05 },
    {
      code: "016708",
      nav: 1.8697,
      navDate: "2026-08-10",
      dayPct: 1.62,
      basis: "published_nav",
    },
    "placeholder",
  );

  assert.equal(result.nav, 1.8697);
  assert.equal(result.navDate, "2026-08-10");
  assert.equal(result.dayPct, 1.62);
  assert.equal(result.costValue, null);
  assert.equal(result.marketValue, null);
  assert.equal(result.dayPnl, null);
});

test("simulation derives fund shares from fixed capital and the baseline NAV", () => {
  const result = valueFundPosition(
    { shares: 0, costAvg: 2.0266, initialCapital: 10000 },
    {
      code: "016708",
      nav: 1.8697,
      navDate: "2026-08-10",
      dayPct: 1.62,
      basis: "published_nav",
    },
    "simulation",
  );

  assert.ok(Math.abs(result.valuedShares - 4934.372841211882) < 1e-10);
  assert.equal(result.costValue, 10000);
  assert.ok(Math.abs(result.marketValue! - 9225.796901213855) < 1e-10);
});

test("simulation fails closed when capital or baseline NAV is invalid", () => {
  const result = valueFundPosition(
    { shares: 0, costAvg: 0, initialCapital: 10000 },
    {
      code: "016708",
      nav: 1.8697,
      navDate: "2026-08-10",
      dayPct: 1.62,
      basis: "published_nav",
    },
    "simulation",
  );

  assert.equal(result.nav, 1.8697);
  assert.equal(result.valuedShares, null);
  assert.equal(result.costValue, null);
  assert.equal(result.marketValue, null);
});

test("signed fund currency keeps the sign before the currency symbol", () => {
  assert.equal(formatSignedCurrency(374, 0), "+¥374");
  assert.equal(formatSignedCurrency(-374, 0), "-¥374");
  assert.equal(formatSignedCurrency(0, 0), "¥0");
});

test("sector ranking does not label positive laggards as decliners", () => {
  assert.deepEqual(
    classifyLaggingSectors([
      { code: "A", name: "甲", change_pct: 0.06 },
      { code: "B", name: "乙", change_pct: 0.11 },
    ]),
    {
      title: "涨幅后十",
      direction: "up",
      items: [
        { code: "A", name: "甲", change_pct: 0.06 },
        { code: "B", name: "乙", change_pct: 0.11 },
      ],
    },
  );
});

test("sector decline ranking excludes non-declining entries", () => {
  assert.deepEqual(
    classifyLaggingSectors([
      { code: "A", name: "甲", change_pct: -1.2 },
      { code: "B", name: "乙", change_pct: 0.04 },
    ]),
    {
      title: "跌幅榜",
      direction: "down",
      items: [{ code: "A", name: "甲", change_pct: -1.2 }],
    },
  );
});

test("live ETF data hydrates immediately and the public security filing stays complete", async () => {
  const [etfPage, etfLive, footer] = await Promise.all([
    readFile(new URL("../src/pages/invest/etf.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/EtfLiveTurnover.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/Footer.astro", import.meta.url), "utf8"),
  ]);

  assert.match(etfPage, /<EtfLiveTurnover client:load\s*\/>/);
  assert.match(etfPage, /fmtPct\(r\.delta_pct\)/);
  assert.doesNotMatch(etfPage, /fmtPct\(r\.delta_pct \* 100\)/);
  assert.match(etfPage, /份额 \{shareCoverage\}\/\{rows\.length\}/);
  assert.match(etfLive, /baseline_date/);
  assert.match(etfLive, /基准待补采/);
  assert.match(etfLive, /腾讯财经/);
  assert.match(footer, /https:\/\/beian\.mps\.gov\.cn\/#\/query\/webSearch\?code=31011502406842/);
  assert.match(footer, /rel="noopener noreferrer"/);
  assert.match(footer, /src="\/备案图标\.png"/);
  assert.match(footer, /沪公网安备31011502406842号/);
});
