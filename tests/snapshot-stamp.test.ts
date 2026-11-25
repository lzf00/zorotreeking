/**
 * 兜底快照的时间戳必须带日期（第 209 轮）。
 *
 * 线上写法是「Wind 静态兜底快照 · 快照时间 16:30:23」—— 只有时分秒。
 * 读者没法判断这是刚才的 16:30 还是上周的 16:30，而兜底快照恰恰最容易变旧
 * （后端接口挂了就一直挂着）。所以快照一律带日期，不是今天还要明说「（非今日）」。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  formatChinaMarketStamp,
  formatChinaMarketTime,
  formatSnapshotWithFreshness,
  isChinaToday,
} from "../src/lib/china-market";

const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
/** 2026-11-25 16:30:23 北京时间（线上 wind-market-latest.json 的 asOf） */
const SNAP = ts("2026-11-25T16:30:23+08:00");
const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("快照时间戳带日期，不再只有时分秒", () => {
  assert.equal(formatChinaMarketStamp(SNAP), "2026-11-25 16:30:23");
  assert.equal(formatChinaMarketTime(SNAP), "16:30:23", "老的纯时间格式保留给实时行情用");
  assert.notEqual(formatChinaMarketStamp(SNAP), formatChinaMarketTime(SNAP));
});

test("是不是「今天」按北京时间算，跨时区不会错一天", () => {
  // 北京时间 2026-11-26 00:30 == UTC 2026-11-25 16:30
  const lateNight = new Date("2026-11-25T16:30:00Z");
  assert.equal(isChinaToday(SNAP, new Date("2026-11-26T07:00:00+08:00")), false);
  assert.equal(isChinaToday(ts("2026-11-26T00:10:00+08:00"), lateNight), true, "UTC 还是 25 号，但北京已经是 26 号");
});

test("不是今天的快照会标「（非今日）」", () => {
  const nextDay = new Date("2026-11-26T07:00:00+08:00");
  assert.equal(formatSnapshotWithFreshness(SNAP, nextDay), "2026-11-25 16:30:23（非今日）");
  const sameDay = new Date("2026-11-25T20:00:00+08:00");
  assert.equal(formatSnapshotWithFreshness(SNAP, sameDay), "2026-11-25 16:30:23", "当天不加噪音");
});

test("非法输入不抛错，给占位符", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(formatChinaMarketStamp(bad), "—");
    assert.equal(formatSnapshotWithFreshness(bad), "—");
    assert.equal(isChinaToday(bad), false);
  }
});

test("两个展示快照的组件都用带日期的格式（不是 formatChinaMarketTime 裸用）", async () => {
  for (const rel of ["src/components/MarketIndicesGrid.tsx", "src/components/StockSpotlight.tsx"]) {
    const src = await read(rel);
    assert.match(src, /formatSnapshotWithFreshness/, `${rel} 没接带日期的快照格式`);
    assert.match(src, /source === "live"[\s\S]{0,200}?formatSnapshotWithFreshness|source === "snapshot"/, `${rel} 里实时/快照要分两种格式`);
  }
});
