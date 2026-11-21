/**
 * 站内搜索的两条新断言（第 118 轮）。
 *
 * 原来的探针只问"有结果吗"，于是这两件事它永远测不出来：
 *   a) 索引是旧的 —— 页面能打开、但搜不到（pagefind 在 build 之后被跳过就会这样）；
 *   b) 命中是死链 —— 索引里残留已删页面的 URL，用户点进去是 404。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertFreshHit,
  deadResultLinks,
  newestDigestDate,
  summarizeSearchProbe,
} from "../scripts/check-search.mjs";

test("最新日报排第 1 名：通过", () => {
  assert.equal(assertFreshHit({ rank: 1 }).ok, true);
  assert.equal(assertFreshHit({ rank: 3 }).ok, true);
});

test("最新日报跌出前 3 名：失败，并说清第几名", () => {
  const bad = assertFreshHit({ rank: 7 });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /第 7 名/);
});

test("最新日报完全搜不到：失败", () => {
  const bad = assertFreshHit(null);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /没有出现在搜索结果/);
});

test("索引里的死链能被挑出来", () => {
  const alive = (url: string) => url !== "/ai/digest-2026-11-01/";
  assert.deepEqual(deadResultLinks(["/ai/digest-2026-11-21/", "/ai/digest-2026-11-01/"], alive), [
    "/ai/digest-2026-11-01/",
  ]);
});

test("从文件列表取最新日报日期，不把周报/随笔算进来", () => {
  assert.equal(newestDigestDate(["digest-2026-11-20.zh.mdx", "digest-2026-11-21.en.mdx"]), "2026-11-21");
  assert.equal(newestDigestDate(["weekly-2026-W46.zh.mdx", "hello-world.zh.mdx"]), null);
  assert.equal(newestDigestDate([]), null);
});

test("索引旧 / 命中死链都算「搜索坏了」（原来只看报错）", () => {
  const healthy = summarizeSearchProbe([{ query: "ETF", total: 10 }]);
  assert.equal(healthy.ok, true);

  const stale = summarizeSearchProbe([
    { query: "ETF", total: 10 },
    { query: "AI 每日精选 · 2026-11-21（索引新鲜度）", total: 200, meta: true, freshness: { url: "/ai/digest-2026-11-21/", rank: 9 } },
  ]);
  assert.equal(stale.ok, false);
  assert.equal(stale.staleIndex.length, 1);

  const dead = summarizeSearchProbe([
    { query: "ETF", total: 10 },
    { query: "搜索结果活链接（抽查 2 条）", total: 2, meta: true, deadLinks: ["/gone/"] },
  ]);
  assert.equal(dead.ok, false);
  assert.deepEqual(dead.deadLinks, ["/gone/"]);
});
