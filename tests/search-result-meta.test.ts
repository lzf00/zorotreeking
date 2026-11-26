/**
 * 搜索结果的「板块 + 类型 + 日期」标签（第 214 轮）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { describeResult } from "../src/lib/search-result-meta";

test("中文日报页标出「AI 日报 · 日期」", () => {
  const meta = describeResult("/ai/digest-2026-11-25/");
  assert.equal(meta.kind, "digest");
  assert.equal(meta.section, "ai");
  assert.equal(meta.date, "2026-11-25");
  assert.equal(meta.label, "AI 日报 · 2026-11-25");
});

test("投资复盘与周报各自有自己的名字", () => {
  assert.equal(describeResult("/invest/market-recap-2026-11-25/").label, "投资复盘 · 2026-11-25");
  assert.equal(describeResult("/ai/weekly-2026-W47/").label, "AI 周报");
  assert.equal(describeResult("/invest/digest-2026-06-05/").label, "投资日报 · 2026-06-05");
});

test("英文结果用英文标签（路径 /en/ 前缀不当作板块）", () => {
  assert.equal(describeResult("/en/ai/digest-2026-11-25/").label, "AI digest · 2026-11-25");
  assert.equal(describeResult("/en/invest/market-recap-2026-11-25/").label, "Invest recap · 2026-11-25");
  assert.equal(describeResult("/en/photo/baokemeng/").label, "Photography");
});

test("人写的笔记不是自动产出类型", () => {
  const meta = describeResult("/ai/hello-world/");
  assert.equal(meta.kind, "post");
  assert.equal(meta.date, null);
  assert.equal(meta.label, "AI 笔记");
});

test("站点级页面不假装属于某个板块", () => {
  for (const route of ["/", "/about/", "/archive/", "/search/", "/tag/etf/", "/en/"]) {
    const meta = describeResult(route);
    assert.equal(meta.section, "site", route);
    assert.equal(meta.date, null, route);
  }
  assert.equal(describeResult("/about/").label, "站点页面");
  assert.equal(describeResult("/en/about/").label, "Site page");
});

test("归档索引页也算日报类，但没日期就不硬编", () => {
  const meta = describeResult("/ai/digest/");
  assert.equal(meta.kind, "digest");
  assert.equal(meta.date, null);
  assert.equal(meta.label, "AI 日报");
});
