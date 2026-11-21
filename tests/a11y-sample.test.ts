/**
 * sitemap 分节抽样（第 124 轮）。
 *
 * 手写路径表只覆盖"我记得的页面"：1188 个 URL 里靠人挑 26 个。抽样要满足三件事，
 * 否则它比手工表还不可靠 —— 同一 seed 必须稳定（失败可复现）、不同 seed 要换页（能扫到新页）、
 * 每个模板类型至少一席（不能被静态小页吃光名额）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { hash, samplePaths, sectionOf, seededOrder, urlsFromSitemap } from "../scripts/lib/a11y-sample.mjs";

const SITEMAP = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.zorotreeking.online/</loc></url>
  <url><loc>https://www.zorotreeking.online/about/</loc></url>
  <url><loc>https://www.zorotreeking.online/privacy/</loc></url>
  <url><loc>https://www.zorotreeking.online/ai/digest-2026-11-20/</loc></url>
  <url><loc>https://www.zorotreeking.online/ai/digest-2026-11-21/</loc></url>
  <url><loc>https://www.zorotreeking.online/invest/digest-2026-11-21/</loc></url>
  <url><loc>https://www.zorotreeking.online/photo/baokemeng/</loc></url>
  <url><loc>https://www.zorotreeking.online/en/ai/digest-2026-11-21/</loc></url>
</urlset>`;

test("sitemap 解析成站内路径（去 origin、去重）", () => {
  const paths = urlsFromSitemap(SITEMAP);
  assert.deepEqual(paths, [
    "/",
    "/about/",
    "/privacy/",
    "/ai/digest-2026-11-20/",
    "/ai/digest-2026-11-21/",
    "/invest/digest-2026-11-21/",
    "/photo/baokemeng/",
    "/en/ai/digest-2026-11-21/",
  ]);
});

test("分节按模板类型，不按路径第一段（小页不占名额）", () => {
  assert.equal(sectionOf("/"), "static");
  assert.equal(sectionOf("/privacy/"), "static");
  assert.equal(sectionOf("/tag/monthly/"), "static");
  assert.equal(sectionOf("/ai/digest-2026-11-21/"), "ai");
  assert.equal(sectionOf("/en/ai/digest-2026-11-21/"), "en/ai");
  assert.equal(sectionOf("/en/terms/"), "en/static");
});

test("同一个 seed 抽同一批页（失败可复现）", () => {
  const paths = urlsFromSitemap(SITEMAP);
  const a = samplePaths(paths, { count: 5, seed: "2026-W47" });
  const b = samplePaths(paths, { count: 5, seed: "2026-W47" });
  assert.deepEqual(a, b);
});

test("不同 seed 会换页（不然等于固定抽查）", () => {
  const paths = Array.from({ length: 40 }, (_, i) => `/ai/digest-2026-11-${String((i % 21) + 1).padStart(2, "0")}/`);
  const a = samplePaths(paths, { count: 3, seed: "seed-a" });
  const b = samplePaths(paths, { count: 3, seed: "seed-b" });
  assert.notDeepEqual(a, b);
});

test("每个模板类型至少一席，且不重复", () => {
  const paths = urlsFromSitemap(SITEMAP);
  const picked = samplePaths(paths, { count: 5, seed: "2026-W47" });
  assert.equal(new Set(picked).size, picked.length, "抽到了重复页");
  const sections = new Set(picked.map(sectionOf));
  assert.ok(sections.size >= 4, `分节太少：${[...sections].join(",")}`);
});

test("名额多于页面数时如实返回全部，不死循环", () => {
  const paths = ["/", "/about/", "/ai/x/"];
  const picked = samplePaths(paths, { count: 99, seed: "s" });
  assert.equal(picked.length, 3);
  assert.deepEqual([...picked].sort(), [...paths].sort());
});

test("seededOrder 是稳定排列且不丢元素", () => {
  const items = ["a", "b", "c", "d", "e"];
  const once = seededOrder(items, "x");
  assert.deepEqual([...once].sort(), [...items].sort());
  assert.deepEqual(once, seededOrder(items, "x"));
  assert.equal(hash("x"), hash("x"));
  assert.notEqual(hash("x"), hash("y"));
});
