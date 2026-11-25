/**
 * 全站归档分页（第 190 轮）。
 *
 * `/archive/` 与 `/en/archive/` 曾经各 368 KB —— 全站最重的两页，一行一篇、五百多条。
 * 现在按 `ARCHIVE_PAGE_SIZE` 切页，年份分节留在页内。
 *
 * 守四件事：
 *   1. 页大小只有一处定义，页面与 sitemap 共用（否则 sitemap 写出不存在的 `/archive/6/`）；
 *   2. `getStaticPaths` 不引用页面局部名字（Astro 会把它提到模块顶部 —— 第 189 轮踩两次）；
 *   3. 组件只渲染"当页"，不再自己去查 collection（否则页数和条数会两处各算一遍）；
 *   4. 分页页进 sitemap、带 rel=prev/next、和中英对端同页码互链。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const ROUTES = [
  ["src/pages/archive/[...page].astro", "zh"],
  ["src/pages/en/archive/[...page].astro", "en"],
] as const;

test("两个归档页都分页，页大小与 sitemap 共用同一常量", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /import \{ ARCHIVE_PAGE_SIZE \} from "@\/lib\/archive-pagination"/, `${file} 没引常量`);
    assert.match(src, /paginate\(posts, \{ pageSize: ARCHIVE_PAGE_SIZE \}\)/, `${file} 没按常量分页`);
  }
  const sitemap = await read("src/pages/sitemap.xml.ts");
  assert.match(sitemap, /ARCHIVE_PAGE_SIZE/, "sitemap 必须用同一个页大小");
  assert.match(sitemap, /pushArchivePages\("\/archive"/, "/archive 分页没进 sitemap");
  assert.match(sitemap, /pushArchivePages\("\/en\/archive"/, "/en/archive 分页没进 sitemap");
});

test("getStaticPaths 里不引用页面局部名字", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    const start = src.indexOf("export async function getStaticPaths");
    const end = src.indexOf("const posts = await loadPosts()", start);
    const code = src
      .slice(start, end === -1 ? src.length : end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bloadPosts\b/, `${file}: getStaticPaths 不能用 loadPosts（TDZ）`);
    assert.doesNotMatch(code, /=== LANG|LANG ===|!== LANG/, `${file}: 不能引用局部 LANG`);
  }
});

test("组件只渲染当页数据，自己不再查 collection", async () => {
  const component = await read("src/components/ArchiveByYear.astro");
  assert.doesNotMatch(component, /getCollection/, "组件不该自己取数（页数会两处各算一遍）");
  assert.match(component, /posts: ArchivePost\[\]/, "要接收当页 posts");
  assert.match(component, /\{total\}/, "总数要来自页面（跨页显示）");
});

test("分页页带 rel=prev/next，并与对端同页码互链", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /rel="prev"/, `${file} 缺 rel=prev`);
    assert.match(src, /rel="next"/, `${file} 缺 rel=next`);
    assert.match(src, /counterpartBase\("\/archive"\)|counterpartBase\("\/en\/archive"\)/, `${file} 没算对端`);
    assert.match(src, /pageCount\(otherTotal, ARCHIVE_PAGE_SIZE\) >= pageNumber/, `${file}: 对端页数不够时不能链`);
  }
});

test("归档页已从重量基线里移除", async () => {
  const baseline = JSON.parse(await read("scripts/page-weight-baseline.json"));
  for (const path of ["/archive/", "/en/archive/"]) {
    assert.equal(baseline[path], undefined, `${path} 已分页瘦身，不该还挂在基线里`);
  }
});
