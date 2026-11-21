/**
 * 东方财富行情 → 页面报价块的纯计算（第 137 轮）。
 *
 * 踩过的两个坑直接写成断言：
 *  1. 价格字段要除以 `10^f59`，指数 2 位、个股 3 位——直接用会差 10 倍；
 *  2. 页面把 IWM 放在"指数"组，但它是 ETF，`100.IWM` 查不到，必须能落到 `107.IWM`。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMarketBlocks, parseQuote, secidCandidates } from "../scripts/lib/us-quotes-compute.mjs";

const payload = (price: number, decimals: number, change: number, pct: number, ts = 1_800_000_000) => ({
  data: { f43: price, f59: decimals, f169: change, f170: pct, f86: ts },
});

test("parseQuote：按 f59 小数位换算价格与涨跌额", () => {
  assert.deepEqual(parseQuote("SPX", payload(691_039, 2, -26_544, -370)), {
    symbol: "SPX", price: 6910.39, change: -265.44, change_pct: -3.7, quote_ts: 1_800_000_000,
  });
  assert.deepEqual(parseQuote("AAPL", payload(342_560, 3, -6_650, -190)), {
    symbol: "AAPL", price: 342.56, change: -6.65, change_pct: -1.9, quote_ts: 1_800_000_000,
  });
});

test("parseQuote：没数据/价格为 0 返回 null，由调用方保留旧值", () => {
  assert.equal(parseQuote("X", { data: null }), null);
  assert.equal(parseQuote("X", payload(0, 2, 0, 0)), null);
});

test("secidCandidates：ETF 优先 107，指数组里的 ETF 也要能回退", () => {
  assert.deepEqual(secidCandidates("SPX", "index"), ["100.SPX", "107.SPX"]);
  assert.deepEqual(secidCandidates("IWM", "index"), ["100.IWM", "107.IWM"], "IWM 在指数组但其实是 ETF");
  assert.deepEqual(secidCandidates("XLK", "etf"), ["107.XLK", "100.XLK"]);
  assert.deepEqual(secidCandidates("AAPL", "stock"), ["105.AAPL"], "个股只有一个前缀");
});

test("buildMarketBlocks：抓不到的标的保留旧值并计入 partial，不整块清空", () => {
  const previous = {
    indices: [{ symbol: "SPX", name: "标普 500", price: 7759.18, change: 6.07, change_pct: 0.08, quote_ts: 1_786_456_805 }],
    sectors: [{ symbol: "XLK", name: "信息技术", price: 186.43, change: 0.11, change_pct: 0.06, quote_ts: 1_786_456_835 }],
    companies: [{ symbol: "AAPL", name: "苹果", price: 306.365, change: -1.895, change_pct: -0.61, quote_ts: 1_786_456_835 }],
  };
  const blocks = buildMarketBlocks(previous, {
    indices: { SPX: payload(691_039, 2, -26_544, -370, 1_800_000_000) },
    sectors: { XLK: { data: null } },
    companies: { AAPL: payload(342_560, 3, -6_650, -190, 1_800_000_001) },
  }, { now: 1_800_000_100 });

  assert.equal(blocks.requested, 3);
  assert.equal(blocks.succeeded, 2);
  assert.equal(blocks.partial, true);
  assert.equal(blocks.stale, false, "抓到数据就不算陈旧");
  assert.equal(blocks.indices[0].price, 6910.39);
  assert.equal(blocks.sectors[0].price, 186.43, "抓不到时保留旧值");
  assert.deepEqual(blocks.problems, ["etf:XLK"]);
  assert.equal(blocks.quote_ts, 1_800_000_001, "取最新的一条行情时间");
});
