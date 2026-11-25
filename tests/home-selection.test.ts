/**
 * 首页精选第一张卡必须是"新鲜"的（第 101 轮）。
 *
 * 线上实测：首屏第一张精选卡是 **2026-06-29** 的自动股票日报，而站点当天已经有 11-20 的内容。
 * 原因是「精选 选 1」的注释写着"最近的原创长文"，代码却只按 `body.length` 排序、完全不看日期 ——
 * 涨停/跌停几十行表格的复盘永远是"最长"的，于是五个月前的旧闻长期霸占首屏。
 *
 * 修法不是隐藏自动内容（这个站 522 篇里 510 篇都是自动产出，隐藏了首页就空了），
 * 而是**先把候选池按日期截到最近 N 篇，再比长度**。
 *
 * 第 206 轮又抓到同一族的第二个洞：只按日期截池还不够 —— market-recap 复盘不是 digest，
 * 一路混进"原创长文"池，靠涨跌停表格天然最长，把首屏占了一周（11-18 的复盘活在 11-25 的首页）。
 * 现在头条位置要求「人写」，用 isAutoReport 把 digest 与 market-recap 一起排掉。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { FEATURED_POOL_SIZE, isAutoReport, isDailyDigest, pickFeatured, pickRecent } from "../src/lib/home-selection";

const post = (translationKey: string, date: string, tags: string[], body = "") => ({
  data: { translationKey, tags, date: new Date(`${date}T00:00:00+08:00`) },
  body,
});
const day = (n: number) => {
  const d = new Date("2026-11-20T00:00:00+08:00");
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("只有 digest 算「日报」，每日复盘不算（它是站点每天的真实产出，不能藏掉）", () => {
  assert.equal(isDailyDigest(post("digest-2026-11-18", "2026-11-18", ["digest"])), true);
  assert.equal(isDailyDigest(post("x", "2026-11-18", ["digest"])), true);
  assert.equal(isDailyDigest(post("market-recap-2026-11-18", "2026-11-18", ["market-recap"])), false);
});

test("五个月前的超长旧文不再霸占首屏（先截池子，再比长度）", () => {
  // 用「人写」内容做样本：自动复盘现在根本不进头条池（第 206 轮），别把两件事混在一起测
  const ancient = { post: post("ancient-note", "2026-06-29", ["ai"], "x".repeat(9000)), section: "ai" };
  const recent = Array.from({ length: FEATURED_POOL_SIZE }, (_, i) => ({
    post: post(`note-${day(i)}`, day(i), ["ai"], "y".repeat(1000 + i)),
    section: "ai",
  }));
  const featured = pickFeatured({ originals: [ancient, ...recent], digests: [], visuals: [] });
  assert.equal(featured.length, 1);
  assert.notEqual(featured[0].post.data.translationKey, "ancient-note", "旧闻又霸屏了");
  assert.ok(recent.some((item) => item.post.data.translationKey === featured[0].post.data.translationKey));
});

test("池子里挑的是最长的那篇，不是最新那篇", () => {
  const newest = { post: post("a-newest", day(0), [], "z".repeat(100)), section: "ai" };
  const longest = { post: post("b-longest", day(3), [], "z".repeat(900)), section: "ai" };
  const featured = pickFeatured({ originals: [newest, longest], digests: [], visuals: [] });
  assert.equal(featured[0].post.data.translationKey, "b-longest");
});

test("三张卡：长文 + 最新 digest + 最新视觉，缺数据时不产生空卡", () => {
  const featured = pickFeatured({
    originals: [{ post: post("note", day(1), [], "a".repeat(500)), section: "ai" }],
    digests: [
      { post: post("digest-old", day(9), ["digest"]), section: "ai" },
      { post: post("digest-new", day(2), ["digest"]), section: "ai" },
    ],
    visuals: [
      { post: post("album-old", day(30), ["photo"]), section: "photo" },
      { post: post("album-new", day(4), ["photo"]), section: "photo" },
    ],
  });
  assert.deepEqual(featured.map((item) => item.post.data.translationKey), ["note", "digest-new", "album-new"]);
  assert.equal(pickFeatured({ originals: [], digests: [], visuals: [] }).length, 0);
});

test("最近更新按日期倒序、排除 digest、保留每日复盘", () => {
  const items = [
    { post: post("digest-2026-11-20", "2026-11-20", ["digest"]), section: "ai" },
    { post: post("market-recap-2026-11-20", "2026-11-20", ["market-recap"]), section: "invest" },
    { post: post("market-recap-2026-11-19", "2026-11-19", ["market-recap"]), section: "invest" },
    { post: post("weekly-2026-W46", "2026-11-15", ["weekly"]), section: "ai" },
  ];
  const recent = pickRecent(items, 3);
  assert.deepEqual(recent.map((item) => item.post.data.translationKey), [
    "market-recap-2026-11-20",
    "market-recap-2026-11-19",
    "weekly-2026-W46",
  ]);
});

test("自动生成的复盘也算「自动内容」，不许进精选头条（第 206 轮的线上 bug）", () => {
  assert.equal(isAutoReport(post("market-recap-2026-11-18", "2026-11-18", ["market-recap", "wind", "daily"])), true);
  assert.equal(isAutoReport(post("x", "2026-11-18", ["market-recap"])), true, "只看 tag 也要认出来");
  assert.equal(isAutoReport(post("digest-2026-11-18", "2026-11-18", ["digest"])), true);
  assert.equal(isAutoReport(post("hello-world", "2026-11-18", ["ai"])), false);

  // 复现：一篇文章 + 一堆复盘，复盘表格最长、日期最新 —— 头条必须还是人写的那篇
  const handwritten = post("ali-grand-loop", day(3), ["travel-guide"], "x".repeat(500));
  const recap = post("market-recap-2026-11-18", day(0), ["market-recap"], "y".repeat(20000));
  const featured = pickFeatured({
    originals: [
      { post: recap, section: "invest" },
      { post: handwritten, section: "hike" },
    ],
    digests: [],
    visuals: [],
  });
  assert.equal(featured[0]?.post.data.translationKey, "ali-grand-loop");
});

test("复盘仍然留在「最近更新」里（它是站点每天的真实产出，不能藏）", () => {
  const recap = post("market-recap-2026-11-25", day(0), ["market-recap"]);
  const recent = pickRecent([{ post: recap, section: "invest" }], 6);
  assert.equal(recent.length, 1);
});
