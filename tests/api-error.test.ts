/**
 * 行情接口报错不许把后端异常原样显示给读者（第 207 轮）。
 *
 * 线上实测（2026-11-26）：后端 /api/market/stocks 的上游（东财 + 腾讯兜底）同时挂了，接口返回
 *   {"ok":false,"error":"('Connection aborted.', RemoteDisconnected('Remote end closed
 *    connection without response')); tencent: tencent stock quotes empty"}
 * 而 6 个行情组件都是 `setError(d.error || L.loadFailed)` —— 这句话就原样出现在页面上：
 * 英文 Python 异常、括号嵌套，还顺带告诉外人「我们用了东财和腾讯」。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { humanizeMarketError, leaksInternalDetail, marketErrorSentence } from "../src/lib/api-error";

/** 线上真实拿到的那段（保持原样，别美化） */
const LIVE_ERROR =
  "('Connection aborted.', RemoteDisconnected('Remote end closed connection without response')); tencent: tencent stock quotes empty";

test("线上那条异常 → 翻成「行情源暂时连不上」，且不含原文", () => {
  const zh = humanizeMarketError(LIVE_ERROR, "zh");
  assert.equal(zh, "行情源暂时连不上");
  assert.equal(leaksInternalDetail(zh), false);
  assert.ok(!/tencent|eastmoney|Connection|Error/i.test(zh), "中文文案里不许留内部细节");
});

test("英文页给英文文案", () => {
  const en = humanizeMarketError(LIVE_ERROR, "en");
  assert.match(en, /unreachable/i);
  assert.ok(!/[\u4e00-\u9fff]/.test(en), "英文页不该混中文");
});

test("超时 / 连接重置 / 5xx 之类都归到同一句，不逐字回显", () => {
  for (const raw of [
    "Read timed out. (read timeout=10)",
    "ConnectionResetError(104, 'Connection reset by peer')",
    "urllib3.exceptions.NewConnectionError: <urllib3.connection.HTTPSConnection object>",
    "Max retries exceeded with url: /qt/stock",
    "EOF occurred in violation of protocol",
  ]) {
    assert.equal(humanizeMarketError(raw, "zh"), "行情源暂时连不上", raw);
  }
});

test("限流单独说，别让人以为是「挂了」", () => {
  assert.equal(humanizeMarketError("rate limit exceeded", "zh"), "请求太频繁，稍后再试");
  assert.equal(humanizeMarketError("HTTP 429 Too Many Requests", "zh"), "请求太频繁，稍后再试");
});

test("空值 / 认不出的错误 → 兜底文案，绝不把原文抛给读者", () => {
  assert.equal(humanizeMarketError(null, "zh"), "网络异常");
  assert.equal(humanizeMarketError("", "zh"), "网络异常");
  assert.equal(humanizeMarketError("something odd happened", "zh"), "加载失败");
  assert.equal(humanizeMarketError(undefined, "zh"), "网络异常");
});

test("leaksInternalDetail：能认出 Python 异常文本", () => {
  assert.equal(leaksInternalDetail(LIVE_ERROR), true);
  assert.equal(leaksInternalDetail('Traceback (most recent call last):\n  File "app.py"'), true);
  assert.equal(leaksInternalDetail("ValueError('bad')"), true);
  assert.equal(leaksInternalDetail("行情源暂时连不上"), false);
  assert.equal(leaksInternalDetail(null), false);
});

test("整句带标点，不会拼出「加载失败：(…」这种", () => {
  assert.equal(marketErrorSentence(LIVE_ERROR, "zh"), "行情源暂时连不上。");
  assert.equal(marketErrorSentence("boom", "en"), "Load failed.");
});

test("6 个行情组件里不再有直接回显 d.error 的写法", async () => {
  const files = [
    "src/components/MarketIndicesGrid.tsx",
    "src/components/MarketSentiment.tsx",
    "src/components/SectorRanking.tsx",
    "src/components/LiveHoldings.tsx",
    "src/components/EtfLiveTurnover.tsx",
    "src/components/StockSpotlight.tsx",
  ];
  for (const rel of files) {
    const src = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
    assert.ok(!/setError\(\s*d\.error/.test(src), `${rel} 还在直接 setError(d.error)`);
    assert.ok(!/throw new Error\(\s*d\.error/.test(src), `${rel} 还在直接 throw d.error`);
    assert.match(src, /humanizeMarketError/, `${rel} 没接上 humanizeMarketError`);
  }
});
