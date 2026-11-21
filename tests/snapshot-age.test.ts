/**
 * 数据快照"多久以前"（第 116 轮）。
 *
 * 起因：/invest/us/ 的兜底数据与 BLS 宏观块停在 2026-08-11（101 天前），
 * 页面只写一句"当前使用最近一次成功缓存"—— 读者会理解成几分钟前的缓存。
 * 金融页面上旧数字冒充当前数字，比没有数字更糟。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { describeSnapshot, humanAge } from "../src/lib/snapshot-age";

const NOW = new Date("2026-11-21T08:00:00Z"); // 北京 16:00

test("101 天前的快照要说出 101 天，并被判为严重陈旧", () => {
  const snap = describeSnapshot(1786456831, NOW); // 2026-08-11 22:00 北京
  assert.equal(snap.days, 101);
  assert.equal(snap.severe, true);
  assert.match(snap.text, /08-11 22:00/);
  assert.match(snap.text, /101 天前/);
});

test("两天前的行情不算严重（阈值默认 7 天）", () => {
  const snap = describeSnapshot(1795035586, NOW);
  assert.equal(snap.days, 2);
  assert.equal(snap.severe, false);
  assert.match(snap.text, /2 天前/);
});

test("跨年才写年份，同年只写月日（界面不啰嗦）", () => {
  assert.doesNotMatch(describeSnapshot(1795035586, NOW).text, /^2026-/);
  assert.match(describeSnapshot(1700000000, NOW).text, /^2023-11-15/);
});

test("空值/非法值不崩，显示「时间未知」", () => {
  for (const bad of [null, undefined, 0, -1, Number.NaN]) {
    const snap = describeSnapshot(bad, NOW);
    assert.equal(snap.text, "时间未知");
    assert.equal(snap.days, null);
    assert.equal(snap.severe, false);
  }
});

test("未来时间不显示成负数天数", () => {
  const future = Math.floor(NOW.getTime() / 1000) + 86400;
  const snap = describeSnapshot(future, NOW);
  assert.equal(snap.days, 0);
  assert.match(snap.text, /今天/);
});

test("humanAge 用中文口语，不出现 0 天前", () => {
  assert.equal(humanAge(0), "今天");
  assert.equal(humanAge(1), "昨天");
  assert.equal(humanAge(45), "45 天前");
  assert.equal(humanAge(null), "时间未知");
});

test("阈值可调：3 天就算严重时 2 天不算", () => {
  const ts = Math.floor(NOW.getTime() / 1000) - 2 * 86400;
  assert.equal(describeSnapshot(ts, NOW, { severeAfterDays: 3 }).severe, false);
  assert.equal(describeSnapshot(ts, NOW, { severeAfterDays: 1 }).severe, true);
});
