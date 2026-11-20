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
