import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const COMPONENT = new URL("../src/components/LiveHoldings.tsx", import.meta.url);

test("持仓表不能在水合前交白卷（曾有 420px 骨架屏，线上 CLS 0.073）", async () => {
  const src = await readFile(COMPONENT, "utf8");
  assert.ok(!src.includes("h-[420px]"), "骨架屏会让首屏高度从 420px 长到 ~1000px，把下面板块全推下去");
  assert.ok(!/if \(!quotes\) \{\s*return/.test(src), "加载中也要把表格画出来（缺的格子用破折号）");
  assert.match(src, /holdingsFailure/, "失败时只加提示条，不要整块不渲染");
});

test(" hydrated 与 SSR 用同一份表格结构", async () => {
  const src = await readFile(COMPONENT, "utf8");
  // rows 必须无条件由 holdings 推导出来（不是 quotes 有值才算）
  assert.match(src, /const rows = holdings\.map/);
});

test("ETF 成交表也不能交白卷（曾有 360px 骨架屏，CLS 0.066）", async () => {
  const src = await readFile(new URL("../src/components/EtfLiveTurnover.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes("h-[360px]"), "骨架屏会在水合后塌缩");
  assert.ok(!/if \(!data\) \{\s*return/.test(src), "没数据也要把表格画出来");
  assert.match(src, /REGISTRY_ROWS/, "SSR 的表格行来自 etf-registry.json");
  assert.match(src, /const rows = data \?/, "SSR 行来自 registry，水合后仍然是稳定顺序");
  assert.match(src, /registryIndex\(a\.code\) - registryIndex\(b\.code\)/, "行序不能跟接口返回顺序走（否则每 60s 重排一次）");
});
