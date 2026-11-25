/**
 * 分页页不进站内搜索索引（第 194 轮）。
 *
 * 这是我自己在第 189–192 轮引入的回归：给日报/归档/标签/更新日志加分页之后，
 * 每个「第 2..N 页」也进了 Pagefind 索引，于是搜索 "归档" 的前五名是
 * `/invest/digest/5/`、`/ai/digest/5/`、`/ai/digest/4/`…… 真正的 `/archive/` 一个都没进。
 * 逻辑上说得通：分页页把 100 条文章标题各重复一遍，词频自然压过正经页面。
 *
 * 这些页本来就该存在（SEO 要 index、要进 sitemap、要有 prev/next），
 * 只是**不该进站内搜索**——它们列的文章都有独立页面。
 *
 * 所以规则是：`pageNumber > 1` 的分页页传 `pagefindIgnore`，第 1 页照旧被收。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const PAGINATED = [
  "src/pages/ai/digest/[...page].astro",
  "src/pages/en/ai/digest/[...page].astro",
  "src/pages/invest/digest/[...page].astro",
  "src/pages/en/invest/digest/[...page].astro",
  "src/pages/archive/[...page].astro",
  "src/pages/en/archive/[...page].astro",
  "src/pages/tag/[tag]/[...page].astro",
  "src/pages/en/tag/[tag]/[...page].astro",
  "src/pages/changelog/[...page].astro",
];

test("九类分页页都在 pageNumber > 1 时跳过站内索引", async () => {
  const missing: string[] = [];
  for (const path of PAGINATED) {
    const src = await read(path);
    if (!/pagefindIgnore=\{pageNumber > 1\}/.test(src)) missing.push(path);
  }
  assert.deepEqual(missing, [], `这些分页页没设 pagefindIgnore：\n${missing.join("\n")}`);
});

test("BaseLayout 把 pagefindIgnore 翻成 data-pagefind-body 的缺席", async () => {
  const src = await read("src/layouts/BaseLayout.astro");
  assert.match(src, /pagefindIgnore\?: boolean;/, "要有这个 prop");
  assert.match(
    src,
    /data-pagefind-body=\{!noindex && !pagefindIgnore \? true : undefined\}/,
    "pagefindIgnore 必须真的让 data-pagefind-body 不输出（否则 Pagefind 还是收）",
  );
});

test("被索引的页面标题页面仍然保留 data-pagefind-body（别把第一页也关掉）", async () => {
  for (const path of PAGINATED) {
    const src = await read(path);
    assert.match(src, /<BaseLayout pagefindIgnore=\{pageNumber > 1\}/, `${path}: 第 1 页必须留在索引里`);
  }
});
