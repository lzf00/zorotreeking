/**
 * 「哪个更新就用哪个」（第 139 轮）。
 *
 * 真实事故：静态快照已被 Actions 刷成 2026-09/10 的新数据，线上 `/api/market/us` 却还返回
 * 2026-08-11 的旧数据。SSR 渲染新数据 → 组件挂载后 fetch 接口 → 旧数据覆盖新数据，
 * 页面在读者眼前退回三个月前，还重新弹出"数据陈旧"。合并必须按时间戳选新的。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeUsMarketDashboardData } from "../src/lib/us-market.ts";

const macro = (fetchedAt: number, reference: string, stale = false) => ({
  source: "bls" as const,
  source_url: "https://www.bls.gov/developers/api_signature_v2.htm",
  fetched_at: fetchedAt,
  stale,
  cpi: { reference, actual: 3.7, expected: null, previous: 3.4, preliminary: false },
  core_cpi: { reference, actual: 2.6, expected: null, previous: 2.4, preliminary: false },
  payroll: { reference, actual: 165, expected: null, previous: 60, preliminary: true },
  unemployment: { reference, actual: 4.1, expected: null, previous: 4.2, preliminary: false },
  trends: { cpi: [], core_cpi: [], payroll: [], unemployment: [] },
  consensus: null,
});

const market = (quoteTs: number, stale = false) => ({
  source: "eastmoney_delayed" as const,
  source_url: "https://quote.eastmoney.com/usstocklist.html",
  quote_ts: quoteTs,
  requested: 1,
  succeeded: 1,
  partial: false,
  stale,
  indices: [{ symbol: "SPX", name: "标普 500", price: 6910.39, change: -265.44, change_pct: -3.7, quote_ts: quoteTs }],
  sectors: [],
  companies: [],
});

const dashboard = (macroBlock: any, marketBlock: any, stale: boolean) => ({
  ok: true,
  ts: Math.max(macroBlock?.fetched_at ?? 0, marketBlock?.quote_ts ?? 0),
  partial: false,
  stale,
  issues: [],
  macro: macroBlock,
  market: marketBlock,
});

test("接口比页面旧：保留页面数据，不能退回三个月前", () => {
  const page = dashboard(macro(1_795_282_908, "2026-09"), market(1_795_206_000), false);
  const api = dashboard(macro(1_786_456_831, "2026-06", true), market(1_786_456_805, true), true);
  const merged = mergeUsMarketDashboardData(page, api);
  assert.equal(merged.macro?.cpi.reference, "2026-09", "保留页面上的新数据");
  assert.equal(merged.macro?.stale, false);
  assert.equal(merged.market?.quote_ts, 1_795_206_000);
  assert.equal(merged.stale, false, "页面上明明是新鲜数据，不能因为接口里旧数据的 stale 显示陈旧");
});

test("接口比页面新：用接口数据（正常轮询路径）", () => {
  const page = dashboard(macro(1_795_282_908, "2026-09"), market(1_795_206_000), false);
  const api = dashboard(macro(1_795_293_000, "2026-10"), market(1_795_300_000), false);
  const merged = mergeUsMarketDashboardData(page, api);
  assert.equal(merged.macro?.cpi.reference, "2026-10");
  assert.equal(merged.market?.quote_ts, 1_795_300_000);
  assert.equal(merged.stale, false);
});

test("接口没带数据：保留页面那两块，也不会因此变成不完整或陈旧", () => {
  const page = dashboard(macro(1_795_282_908, "2026-09"), market(1_795_206_000), false);
  const merged = mergeUsMarketDashboardData(page, { ...dashboard(null, null, true), macro: null, market: null });
  assert.equal(merged.macro?.cpi.reference, "2026-09");
  assert.equal(merged.market?.quote_ts, 1_795_206_000);
  // 两块都在且都是新的：接口这一次没带数据，不代表页面数据不完整
  assert.equal(merged.partial, false);
  assert.equal(merged.stale, false);
});

test("页面没有初始数据（首屏直连接口）：直接用接口数据", () => {
  const api = dashboard(macro(1_786_456_831, "2026-06", true), market(1_786_456_805, true), true);
  const merged = mergeUsMarketDashboardData(null, api);
  assert.equal(merged.macro?.cpi.reference, "2026-06");
  assert.equal(merged.stale, true, "只有旧数据时仍要老实标记陈旧");
});
