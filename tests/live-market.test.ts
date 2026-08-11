import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
        nav: 0.5752,
        nav_date: "2026-08-10",
        est_nav: 0.6602,
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
      dayPct: 2.46,
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

test("fund position PnL uses the published NAV and its published NAV date", () => {
  const result = valueFundPosition(
    { shares: 5000, costAvg: 0.65 },
    {
      code: "012414",
      nav: 0.5752,
      navDate: "2026-08-10",
      dayPct: 2.46,
      basis: "published_nav",
    },
  );

  assert.equal(result.marketValue, 2876);
  assert.equal(result.costValue, 3250);
  assert.ok(Math.abs(result.dayPnl - 69.05094671091138) < 1e-10);
  assert.equal(result.navDate, "2026-08-10");
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
