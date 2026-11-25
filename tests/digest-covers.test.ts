/**
 * digest 封面不许挤在两张图上（第 111 轮）。
 *
 * 线上实况：归档页 680 篇 digest 只有 13 张不同封面，其中 **630 篇锁死在 2 张图**上 ——
 * 翻两屏就是同一张图反复出现。根因是封面在生成时按"当下的相册池"取，池子从 2 张长到 40 张，
 * 早期生成的那批永远不变；加上 `hash % 池子` 分布不均。
 *
 * 现在改成"日期 → 天数 × 互质步长 → 取模"：确定性、铺满池子、相邻两天不撞。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { pickIndex } from "../scripts/lib/cover-picker.ts";
import { digestDate, withCover } from "../scripts/backfill-digest-covers.ts";

const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;

test("同一天永远选同一张（重跑、重建都不抖）", () => {
  for (const date of ["2026-11-21", "2025-03-04", "2024-12-31"]) {
    assert.equal(pickIndex(date, 40), pickIndex(date, 40));
  }
});

test("相邻两天不会撞同一张，且雨天能铺满整个池子", () => {
  const pool = 40;
  const twoDays = Array.from({ length: 2 }, (_, i) => pickIndex(day(i + 1), pool));
  assert.notEqual(twoDays[0], twoDays[1]);
  const fortyDays = new Set(Array.from({ length: pool }, (_, i) => pickIndex(day(i + 1), pool)));
  assert.equal(fortyDays.size, pool, `40 天只覆盖了 ${fortyDays.size} 张，步长与池子不互质`);
});

test("索引始终落在池子边界内，空池子返回 -1", () => {
  for (let i = 0; i < 500; i++) {
    const idx = pickIndex(`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, 7);
    assert.ok(idx >= 0 && idx < 7, `索引 ${idx} 越界`);
  }
  assert.equal(pickIndex("2026-11-21", 0), -1);
});

test("frontmatter 改写：替换已有 cover、缺了就插、没变化返回 null", () => {
  const base = '---\nlang: zh\ndate: 2026-11-21\ntags: [digest]\n---\n\n正文 cover: 不该被动\n';
  // 注意：withCover 自己加引号，传值不要带引号
  assert.match(withCover(base, "/photos/a.jpg")!, /cover: "\/photos\/a\.jpg"/, "没有 cover 时要补上");
  const inserted = withCover(base, "/photos/a.jpg")!;
  assert.match(inserted, /date: 2026-11-21\ncover: "\/photos\/a\.jpg"\n/);
  assert.equal(withCover(inserted, "/photos/a.jpg"), null, "内容没变就不该重写文件");
  const replaced = withCover(inserted, "/photos/b.jpg")!;
  assert.match(replaced, /cover: "\/photos\/b\.jpg"/);
  assert.ok(replaced.endsWith("正文 cover: 不该被动\n"), "正文不能被改");
});

test("日期优先取 frontmatter，缺失时回退文件名", () => {
  assert.equal(digestDate("date: 2026-11-21\n", "digest-2026-11-20.zh.mdx"), "2026-11-21");
  assert.equal(digestDate("tags: [digest]\n", "digest-2026-11-20.zh.mdx"), "2026-11-20");
  assert.equal(digestDate("tags: [digest]\n", "nope.zh.mdx"), null);
});
