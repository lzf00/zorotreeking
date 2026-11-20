import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SITEMAP = new URL("../src/pages/sitemap.xml.ts", import.meta.url);

test("sitemap 声明 image 命名空间并输出相册图片条目", async () => {
  const src = await readFile(SITEMAP, "utf8");
  assert.match(src, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(src, /<image:image><image:loc>/);
  // 图片必须走派生 webp（原图常常几百 KB），图片搜索没必要抓原图
  assert.match(src, /photo\.srcWebp \?\? photo\.src/);
});

test("每册图片条目要有上限，别把 sitemap 撑爆", async () => {
  const src = await readFile(SITEMAP, "utf8");
  assert.match(src, /photos\.slice\(0, IMAGES_PER_ALBUM\)/);
  const cap = Number(src.match(/const IMAGES_PER_ALBUM = (\d+);/)?.[1] ?? Number.NaN);
  assert.ok(Number.isFinite(cap) && cap > 0 && cap <= 50, `每册上限应在 1..50，实际 ${cap}`);
});

test("图片条目带 title/caption，且都做 XML 转义", async () => {
  const src = await readFile(SITEMAP, "utf8");
  assert.match(src, /<image:title>\$\{escapeXml\(img\.title\)\}<\/image:title>/);
  assert.match(src, /<image:caption>\$\{escapeXml\(img\.caption\)\}<\/image:caption>/);
});
