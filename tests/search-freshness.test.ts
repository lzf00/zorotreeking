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
  assertTitleRank,
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

// 第 134 轮：聚合页（标签页/归档页）把 189 期标题全列出来，词频天然高于单篇，
// 用完整标题查询时单篇排到第 9 名是**正常的**，不能当成"索引没更新"。
test("排在聚合页后面但压过所有旧期，算新鲜", () => {
  const top = [
    "/tag/tonghuashun/",
    "/invest/digest/",
    "/tag/digest/",
    "/tag/auto/",
    "/invest/digest-2026-11-21/",
    "/invest/digest-2026-10-21/",
  ];
  const hit = assertFreshHit({ rank: 5, url: "/invest/digest-2026-11-21/", top });
  assert.equal(hit.ok, true, hit.reason ?? "");
});

test("最新一期反而排在旧期后面，仍然要红（这才是索引没更新）", () => {
  const top = ["/invest/digest/", "/invest/digest-2026-11-20/", "/invest/digest-2026-11-21/"];
  const hit = assertFreshHit({ rank: 3, url: "/invest/digest-2026-11-21/", top });
  assert.equal(hit.ok, false);
  assert.match(hit.reason, /旧期 \/invest\/digest-2026-11-20\//);
});

test("没有旧期压在前面就算新鲜（聚合页排前面是正常的）", () => {
  const hit = assertFreshHit({ rank: 9, url: "/invest/digest-2026-11-21/", top: ["/tag/auto/", "/invest/digest/"] });
  assert.equal(hit.ok, true, hit.reason ?? "");
});

test("完全没有命中仍然要红", () => {
  const hit = assertFreshHit({ rank: null, url: "/invest/digest-2026-11-21/", top: [] });
  assert.equal(hit.ok, false);
});

// 第 139 轮：标题探针降级为警告。真实事故：`投资资讯日报 · 2026-11-22` 零命中，
// 但同一页面查询 `2026-11-22` 排第 1 —— 索引是新的，红的是探针不是索引。
test("标题整句搜不到：只算警告，不算搜索坏了", () => {
  const verdict = assertTitleRank(null);
  assert.equal(verdict.ok, true);
  assert.match(verdict.warning ?? "", /分词噪声/);
});

test("标题能搜到但排在旧期后面：仍然要报出来", () => {
  const verdict = assertTitleRank({
    rank: 3,
    url: "/invest/digest-2026-11-22/",
    // 榜单第 3 位才是最新一期，前面压着一期 05-22：这才是"索引没更新"的形状
    top: ["/tag/digest/", "/invest/digest-2026-05-22/", "/invest/digest-2026-11-22/"],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.warning ?? "", /旧期/);
});

test("标题警告不参与 ok 判定（日期探针才是硬指标）", () => {
  const summary = summarizeSearchProbe([
    { query: "2026-11-22（索引新鲜度）", total: 287, freshness: { url: "/invest/digest-2026-11-22/", rank: 1, top: ["/invest/digest-2026-11-22/"], titleRank: null } },
  ]);
  assert.equal(summary.ok, true);
  assert.equal(summary.staleIndex.length, 0);
  assert.equal(summary.titleWarnings.length, 1);
});
