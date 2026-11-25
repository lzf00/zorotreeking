/**
 * 搜索空结果页必须"给下一站"（第 203 轮）。
 *
 * 旧版只有一行「没有匹配结果」：读者不知道是关键词太细、太长，还是站里确实没写过，
 * 也没有下一站可去，只能关页面走人。同一类毛病在 `/now/` 上已经犯过一次
 * （第 181 轮：老实说"137 天没更新"，然后就没了）。
 *
 * 这里锁三件事：文案随关键词形态变化、EN 版不许出现中文、给出的入口都是站内真实路由。
 */
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

import { queryWeight, searchEmptyState, termCount } from "../src/lib/search-empty";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const CJK = /[\u3400-\u9fff]/;

test("termCount：中文按连续汉字算一段，英文按空白切", () => {
  assert.equal(termCount("宝可梦"), 1);
  assert.equal(termCount("宝 可 梦"), 3, "带空格就当成三个词");
  assert.equal(termCount("etf 三因子"), 2);
  assert.equal(termCount("   "), 0);
  assert.equal(termCount("v7.2"), 1);
});

test("queryWeight：CJK 按字算，英文按词算", () => {
  assert.equal(queryWeight("宝可梦"), 3);
  assert.equal(queryWeight("three factor etf"), 3);
  assert.ok(queryWeight("我想知道这个站有没有写过关于徒步路线的详细攻略") >= 12);
});

test("词多 → 提示「给得太细」，而不是「这个站没写过」", () => {
  const state = searchEmptyState("宝可梦 相册 照片 高清", "zh");
  assert.match(state.headline, /太细/);
  assert.equal(state.tips.length, 2);
  assert.match(state.tips[0], /一两个词/);
});

test("一整句话 → 提示「像一整句话」", () => {
  const state = searchEmptyState("我想知道这个站有没有写过关于徒步路线的详细攻略", "zh");
  assert.match(state.headline, /一整句话/);
});

test("短词 → 老实说大概没写过，并留出口", () => {
  const state = searchEmptyState("宝可梦", "zh");
  assert.match(state.headline, /大概还没写过/);
  assert.ok(state.stops.length >= 3);
});

test("EN 版不许出现中文（英文页混中文会被 i18n 守卫拦）", () => {
  for (const query of ["pokemon", "a b c", "this is a really long english sentence about hiking"]) {
    const state = searchEmptyState(query, "en");
    const text = [state.headline, ...state.tips, ...state.stops.map((s) => s.label)].join(" ");
    assert.doesNotMatch(text, CJK, `EN 空结果文案里有中文：${text}`);
  }
});

test("给出的入口都是站内真实存在的路由（源文件为证）", async () => {
  const sources: Record<string, string> = {
    "/tag/": "src/pages/tag/[tag]",
    "/archive/": "src/pages/archive/[...page].astro",
    "/explore/": "src/pages/explore.astro",
    "/guestbook/": "src/pages/guestbook.astro",
    "/en/tag/": "src/pages/en/tag",
    "/en/archive/": "src/pages/en/archive/[...page].astro",
    "/en/guestbook/": "src/pages/en/guestbook.astro",
  };
  for (const lang of ["zh", "en"] as const) {
    for (const stop of searchEmptyState("x", lang).stops) {
      const rel = sources[stop.href];
      assert.ok(rel, `空结果入口 ${stop.href} 没有登记到源文件映射里`);
      await stat(new URL(`../${rel}`, import.meta.url));
    }
  }
});

test("组件真的用上了它，并且带 data-search-empty 供交互测试定位", async () => {
  const source = await read("src/components/SearchModal.tsx");
  assert.match(source, /from "@\/lib\/search-empty"/);
  assert.match(source, /searchEmptyState\(query, lang\)/, "必须按当前关键词与语言渲染");
  assert.match(source, /data-search-empty=""/, "留一个稳定的选择器");
  assert.match(source, /emptyBlock\(query, lang, "page"\)/);
  assert.match(source, /emptyBlock\(query, lang, "modal"\)/);
});
