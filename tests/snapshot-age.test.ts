/**
 * 数据快照"多久以前"（第 116 轮）。
 *
 * 起因：/invest/us/ 的兜底数据与 BLS 宏观块停在 2026-08-11（101 天前），
 * 页面只写一句"当前使用最近一次成功缓存"—— 读者会理解成几分钟前的缓存。
 * 金融页面上旧数字冒充当前数字，比没有数字更糟。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { describeIsoSnapshot, describeSnapshot, humanAge, parseSnapshotIso } from "../src/lib/snapshot-age";

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

test("无时区的 ISO 字符串按北京时间解释，不随运行环境变化（CI 是 UTC）", () => {
  // 这条是第 117 轮线上翻车后补的：同一份快照 `2026-11-20T16:30:09`，
  // 本地构建显示"昨天"，UTC 的 CI 构建显示"今天" —— 差一天。
  const now = Date.parse("2026-11-21T08:52:00Z"); // = 北京 16:52
  const snap = describeIsoSnapshot("2026-11-20T16:30:09.758465", now);
  assert.equal(snap.days, 1);
  assert.match(snap.text, /昨天/);
  assert.match(snap.text, /11-20 16:30/);
});

test("带时区的字符串照它自己的偏移解释", () => {
  const now = Date.parse("2026-11-21T08:52:00Z");
  const utcSnap = describeIsoSnapshot("2026-11-20T16:30:09Z", now); // 北京 11-21 00:30 → 今天
  assert.equal(utcSnap.days, 0);
  const isoSnap = describeIsoSnapshot("2026-11-20T16:30:09+08:00", now); // 北京 11-20 16:30 → 昨天
  assert.equal(isoSnap.days, 1);
});

test("坏时间/空值不崩", () => {
  for (const bad of [null, undefined, "", "not-a-date"]) {
    assert.equal(describeIsoSnapshot(bad, Date.parse("2026-11-21T08:52:00Z")).text, "时间未知");
  }
});

test("parseSnapshotIso：缺时区按北京时间，带时区照原样", () => {
  assert.equal(parseSnapshotIso("2026-11-20T16:30:09"), Date.parse("2026-11-20T16:30:09+08:00"));
  assert.equal(parseSnapshotIso("2026-11-20T16:30:09Z"), Date.parse("2026-11-20T16:30:09Z"));
  assert.equal(parseSnapshotIso("2026-11-20T16:30:09+09:00"), Date.parse("2026-11-20T16:30:09+09:00"));
});

// 第 135 轮：首屏那句「宏观数据停在 2026-08-11」必须与当前时间无关，
// 否则 SSR 和客户端水合会算出不同字符串（时间一到就水合告警）。
test("absoluteStamp：只给绝对日期，永远不带“N 天前”", async () => {
  const { absoluteStamp } = await import("../src/lib/snapshot-age.ts");
  assert.equal(absoluteStamp(Date.parse("2026-08-11T14:00:00Z") / 1000), "2026-08-11");
  assert.equal(absoluteStamp(Date.parse("2026-08-11T17:30:00Z") / 1000), "2026-08-12"); // 北京时间跨日
  for (const bad of [null, undefined, 0, -1, Number.NaN]) assert.equal(absoluteStamp(bad), "未知时间");
});

test("美股首屏必须自曝宏观数据陈旧（不能只在页脚写小字）", async () => {
  const { readFile } = await import("node:fs/promises");
  const component = await readFile(new URL("../src/components/UsMarketDashboard.tsx", import.meta.url), "utf8");
  assert.match(component, /macro\?\.stale && \(/, "必须有 macro?.stale 分支");
  // 首屏 = 温度计标题之后、第一张 MacroCard 之前（注意 `<MacroCard` 的首次出现是函数定义）
  const titleAt = component.indexOf('id="us-thermometer-title"');
  const firstCardAt = component.indexOf("<MacroCard", titleAt);
  assert.ok(titleAt > 0 && firstCardAt > titleAt, "组件结构变了，测试要同步");
  const hero = component.slice(titleAt, firstCardAt);
  assert.match(hero, /宏观数据停在/, "提示要在首屏卡片里");
  assert.match(hero, /absoluteStamp\(macro\.fetched_at\)/, "用绝对日期，避免水合不一致");
  assert.doesNotMatch(hero, /describeSnapshot\(macro\.fetched_at\)/, "首屏不要用相对时间");
});
