/**
 * 标签页分页（第 191 轮）。
 *
 * `/tag/auto/` 308 KB、`/en/tag/auto/` 311 KB、`/tag/digest/` 299 KB —— 标签页是全站
 * 最后一族重页面（一字标签 431 条挤一页）。按 100 条一页切，重标签落到 ~180 KB；
 * 58 个标签页里大多数不足 100 条，URL 一个不变。
 *
 * 守四件事：
 *   1. 页大小只有一处定义（`src/lib/tag-pagination.ts`），页面与 sitemap 共用；
 *   2. 第 1 页仍是 `/tag/<slug>/`（rest 参数缺省），且只有超过阈值才多出页来；
 *   3. 分页页进 sitemap、带 rel=prev/next；
 *   4. 第 2 页起的语言切换自己给，且对端页数不够时不链。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const ROUTES = [
  ["src/pages/tag/[tag]/[...page].astro", "zh"],
  ["src/pages/en/tag/[tag]/[...page].astro", "en"],
] as const;

test("标签页分页且页大小与 sitemap 共用常量", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /import \{ TAG_PAGE_SIZE \} from "@\/lib\/tag-pagination"/, `${file} 没引常量`);
    assert.match(src, /pageCount\(posts\.length, TAG_PAGE_SIZE\)/, `${file} 没按常量切页`);
  }
  const sitemap = await read("src/pages/sitemap.xml.ts");
  assert.match(sitemap, /TAG_PAGE_SIZE/, "sitemap 必须用同一个页大小");
  assert.match(sitemap, /pagePaths\(base, countByTag\.get\(tag\) \?\? 0, TAG_PAGE_SIZE\)/, "标签分页没进 sitemap");
});

test("第 1 页保持原 URL：rest 参数缺省，只有超阈值才多页", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /page: i === 0 \? undefined : String\(i \+ 1\)/, `${file}: 第 1 页必须落在原路径`);
    assert.match(src, /Array\.from\(\{ length: pages \}/, `${file}: 应按页数展开`);
  }
});

test("分页页带 rel=prev/next，并在第 2 页起自己给语言切换", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /rel="prev"/, `${file} 缺 rel=prev`);
    assert.match(src, /rel="next"/, `${file} 缺 rel=next`);
    assert.match(src, /pageNumber > 1 && hasCounterpart/, `${file}: 对端页数不够时不链`);
    assert.match(src, /pageCount\(otherCount, TAG_PAGE_SIZE\) >= pageNumber/, `${file}: 要按对端页数判断`);
  }
});

test("只有第 1 页带摘要（第 2 页起全走紧凑行）", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /pageNumber === 1 \? DETAILED_COUNT : 0/, `${file}: 摘要只该在第 1 页出现`);
  }
});
