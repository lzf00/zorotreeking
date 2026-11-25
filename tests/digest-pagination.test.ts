/**
 * 日报归档分页（第 189 轮）。
 *
 * 四个归档页（zh/en × ai/invest）此前把**全部期数**渲染进一页：220–232 KB HTML、
 * DOM 里几百行卡片。第 133 轮砍过一半（429 KB → 213 KB，方式是"不再给每期配图"），
 * 但条目数一条没少。这一轮按 48 期分页。
 *
 * 这个测试守四件事（都是踩过的坑）：
 *   1. 分页大小只有一处定义 —— 页面和 sitemap 必须引同一个常量，否则 sitemap 会写出
 *      服务器上不存在的 `/ai/digest/6/`，`check:seo` 判红；
 *   2. `getStaticPaths` 里不许引用页面局部的 `const` —— Astro 把它提到模块顶部、
 *      把页面主体包进函数，引用了就是 TDZ / "isDigest is not defined"（实测两次红）；
 *   3. "最新 6 期大卡片"只在第一页；
 *   4. 分页导航真的带 rel=prev/next，否则爬虫把第 2..N 页当孤立页。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const ROUTES = [
  ["src/pages/ai/digest/[...page].astro", "ai/digest"],
  ["src/pages/en/ai/digest/[...page].astro", "en/ai/digest"],
  ["src/pages/invest/digest/[...page].astro", "invest/digest"],
  ["src/pages/en/invest/digest/[...page].astro", "en/invest/digest"],
] as const;

test("四个归档页都分页，且共用同一个页大小常量", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /import \{[^}]*\bDIGEST_PAGE_SIZE\b[^}]*\} from "@\/lib\/digest-pagination"/, `${file} 没引常量`);
    assert.match(src, /paginate\(items, \{ pageSize: DIGEST_PAGE_SIZE \}\)/, `${file} 没按常量分页`);
    assert.match(src, /export async function getStaticPaths/, `${file} 缺 getStaticPaths`);
  }
});

test("getStaticPaths 里不引用页面局部 const（Astro 会把它提到模块顶部）", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    const start = src.indexOf("export async function getStaticPaths");
    // 取函数体：从 start 到页面主体开始（`const digests`）之间
    const end = src.indexOf("const digests", start);
    const body = src.slice(start, end === -1 ? src.length : end);
    // 去掉注释再判（注释里提到这些名字是在解释"为什么不能用"）
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bisDigest\b/, `${file}: getStaticPaths 里不能用 isDigest`);
    // `p.data.lang` 是属性访问、没问题；locally 的 `lang` 常量才是 TDZ 来源
    assert.doesNotMatch(code, /===\s*lang\b|!==\s*lang\b/, `${file}: 不能引用局部 lang 常量`);
  }
});

test("sitemap 收录分页页（可索引页漏收录会判红）", async () => {
  const sitemap = await read("src/pages/sitemap.xml.ts");
  assert.match(sitemap, /digestPagePaths/, "sitemap 要按同一个函数算分页路径");
  for (const [, base] of ROUTES) assert.match(sitemap, new RegExp(`pushDigestPages\\("/${base}"`), `${base} 没进 sitemap`);
});

test("大卡片只在第一页；分页导航带 rel=prev/next", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /const rich = pageNumber === 1 && cardIndex < FEATURED_COUNT;/, `${file}: 大卡片没限定首页`);
    assert.match(src, /rel="prev"/, `${file} 缺 rel=prev`);
    assert.match(src, /rel="next"/, `${file} 缺 rel=next`);
    assert.match(src, /page\.url\.prev/, `${file} 没用 Astro 的分页 URL`);
  }
});

test("瘦回预算内的页面已从重量基线里移除", async () => {
  const baseline = JSON.parse(await read("scripts/page-weight-baseline.json"));
  for (const path of ["/ai/digest/", "/en/ai/digest/", "/invest/digest/", "/en/invest/digest/"]) {
    assert.equal(baseline[path], undefined, `${path} 已经分页瘦身，不该还挂在基线里`);
  }
});

test("分页页按同一页码和中英对端互链（check:lang-switch 会判红）", async () => {
  for (const [file] of ROUTES) {
    const src = await read(file);
    assert.match(src, /counterpartBase\(/, `${file}: 要按语言前缀算对端`);
    assert.match(src, /hasCounterpart/, `${file}: 对端页数不够时不能链（会指向不存在的页）`);
    assert.match(src, /English|中文/, `${file}: 缺切换链接文案`);
  }
});
