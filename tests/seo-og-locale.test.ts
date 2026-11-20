import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const LAYOUT = new URL("../src/layouts/BaseLayout.astro", import.meta.url);

test("每个页面都要有 og:locale，中英分别映射 zh_CN / en_US", async () => {
  const src = await readFile(LAYOUT, "utf8");
  assert.match(src, /<meta property="og:locale" content=\{lang === "zh" \? "zh_CN" : "en_US"\} \/>/);
});

test("有对应语言版本的页面要多给一条 og:locale:alternate", async () => {
  const src = await readFile(LAYOUT, "utf8");
  // 只在 hasLanguageAlternate 时输出：单语页（如中文独有游记）给 alternate 会指错语言
  assert.match(src, /hasLanguageAlternate && \(\s*<meta property="og:locale:alternate" content=\{lang === "zh" \? "en_US" : "zh_CN"\} \/>/);
});

test("og:site_name 必须存在（社媒卡片标题后通常显示站点名）", async () => {
  const src = await readFile(LAYOUT, "utf8");
  assert.match(src, /<meta property="og:site_name" content=\{siteName\} \/>/);
});
