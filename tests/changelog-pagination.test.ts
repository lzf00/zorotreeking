/**
 * 更新日志分页（第 192 轮）。
 *
 * `/changelog/` 是唯一一页会**永远线性增长**的页面：内容直接来自 `git log`，每个提交 +~0.8 KB。
 * 实测 397 条 → 370 KB（内联 CSS 96 KB + 条目 274 KB），全站最重。
 *
 * 第 181 轮曾用「判单条成本而不是总量」绕开它 —— 那只是把**判据**修好了，字节还在涨；
 * 而且单条口径把 96 KB 内联 CSS 也摊进每一条，页面一分页，口径立刻失真（分母从 397 掉到 100）。
 * 这一轮改成结构上界：每页 `CHANGELOG_PAGE_SIZE` 条，页大小有上界。
 *
 * 守四件事：
 *   1. 页大小只有一处定义，页面与 sitemap 共用（否则 sitemap 会写出不存在的 `/changelog/6/`）；
 *   2. `getStaticPaths` 不引用页面局部名字（Astro 会把它提到模块顶部，第 189 轮踩过两次）；
 *   3. 分页页带 rel=prev/next，且进 sitemap；
 *   4. 单条成本机制退役后，重量基线里不再有 `/changelog/`（改由这条结构上界兜底）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("更新日志按 CHANGELOG_PAGE_SIZE 分页，sitemap 用同一个常量", async () => {
  const page = await read("src/pages/changelog/[...page].astro");
  assert.match(page, /import \{ CHANGELOG_PAGE_SIZE \} from "@\/lib\/changelog-pagination"/, "没引常量");
  assert.match(page, /paginate\(visible, \{ pageSize: CHANGELOG_PAGE_SIZE \}\)/, "没按常量分页");
  const sitemap = await read("src/pages/sitemap.xml.ts");
  assert.match(sitemap, /pagePaths\("\/changelog", changelogVisible, CHANGELOG_PAGE_SIZE\)/, "分页页没进 sitemap");
});

test("getStaticPaths 不引用页面局部名字（否则 TDZ）", async () => {
  const src = await read("src/pages/changelog/[...page].astro");
  const start = src.indexOf("export async function getStaticPaths");
  const end = src.indexOf("// 页面主体再读一次同一个来源");
  const code = src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bvisibleCount\b/, "不能引用页面主体的变量");
  assert.doesNotMatch(code, /\bhiddenCount\b/, "不能引用页面主体的变量");
});

test("分页页带 rel=prev/next 与页码", async () => {
  const src = await read("src/pages/changelog/[...page].astro");
  assert.match(src, /rel="prev"/, "缺 rel=prev");
  assert.match(src, /rel="next"/, "缺 rel=next");
  assert.match(src, /page\.url\.prev/, "要用 paginate 给的 url");
});

test("单条成本机制已退役，重量基线里没有 /changelog/", async () => {
  const baseline = JSON.parse(await read("scripts/page-weight-baseline.json"));
  assert.equal(baseline["/changelog/"], undefined, "分页后它已回到预算内，不该还挂在基线里");
  const lib = await read("scripts/lib/page-weight.mjs");
  assert.doesNotMatch(lib, /PER_ENTRY_PAGES/, "退役的机制不该留在库里");
});
