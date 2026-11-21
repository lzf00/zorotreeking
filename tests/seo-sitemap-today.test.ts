/**
 * sitemap 的 lastmod 不能因为时区被判成"未来日期"（第 139 轮）。
 *
 * 真实事故：北京时间 2026-11-22 凌晨 02:47 产出当天日报，lastmod = 2026-11-22，
 * 而检查用的是 UTC 日期（此时还是 2026-11-21），于是 36 条 "lastmod 晚于今天" 把
 * 整条发布链拦住。这个窗口每天都会出现（00:00–08:00 北京），正好盖住夜间日报流水线。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("SEO 检查里的“今天”必须是北京时间，不能是 UTC", async () => {
  const script = await read("scripts/check-seo.mjs");
  const line = script.split("\n").find((row) => row.includes("const today = new Date("));
  assert.ok(line, "找不到 today 的定义");
  assert.match(line!, /8 \* 3600 \* 1000/, "要按 UTC+8 换算，和内容日期同一时区");
  assert.doesNotMatch(line!, /new Date\(\)\.toISOString/, "裸 UTC 日期会在凌晨误判当天内容为未来");
});

test("凌晨产的当天内容不会被判成“未来”（还原事故时刻）", () => {
  // 北京 2026-11-22 02:47 = UTC 2026-11-21 18:47
  const utcNow = new Date("2026-11-21T18:47:00Z");
  const beijingToday = new Date(utcNow.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const utcToday = utcNow.toISOString().slice(0, 10);
  const lastmod = "2026-11-22";
  assert.equal(beijingToday, "2026-11-22");
  assert.equal(utcToday, "2026-11-21");
  assert.ok(lastmod <= beijingToday, "北京时间口径下当天内容不算未来");
  assert.ok(lastmod > utcToday, "这正是原来会误报的原因");
});
