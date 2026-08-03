import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatChinaMarketTime, isChinaATradingHours } from "../src/lib/china-market";
import { summarizePortfolioValuation } from "../src/lib/portfolio-valuation";

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

test("live ETF data hydrates immediately and the public security filing stays complete", async () => {
  const [etfPage, footer] = await Promise.all([
    readFile(new URL("../src/pages/invest/etf.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/Footer.astro", import.meta.url), "utf8"),
  ]);

  assert.match(etfPage, /<EtfLiveTurnover client:load\s*\/>/);
  assert.match(footer, /https:\/\/beian\.mps\.gov\.cn\/#\/query\/webSearch\?code=31011502406842/);
  assert.match(footer, /rel="noopener noreferrer"/);
  assert.match(footer, /src="\/备案图标\.png"/);
  assert.match(footer, /沪公网安备31011502406842号/);
});
