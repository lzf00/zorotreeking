import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error 纯 ESM 脚本没有类型声明，测试里按结构化数据断言
const { coverFromFrontmatter, variantPath } = await import("../scripts/cover-variants.mjs");

test("只认本站 /photos/ 封面，外链和缺失都返回 null", () => {
  assert.equal(coverFromFrontmatter('cover: "/photos/uploads/baokemeng/baokemeng-01.og.jpg"'), "/photos/uploads/baokemeng/baokemeng-01.og.jpg");
  assert.equal(coverFromFrontmatter("cover: /photos/a/b.og.png"), "/photos/a/b.og.png");
  assert.equal(coverFromFrontmatter('cover: "https://cdn.example.com/x.jpg"'), null);
  assert.equal(coverFromFrontmatter("title: 没有封面"), null);
});

test("变体路径是插在扩展名前，而不是覆盖整个文件名", () => {
  assert.equal(variantPath("/photos/a/b.og.jpg", 640), "/photos/a/b.og.w640.jpg");
  assert.equal(variantPath("/photos/a/b.og.jpeg", 960), "/photos/a/b.og.w960.jpeg".replace(".jpeg", ".jpg"));
  assert.equal(variantPath("/photos/a/b.og.png", 640), "/photos/a/b.og.w640.jpg");
  // 照片站新导出的是 webp，也得生成 jpg 变体
  assert.equal(variantPath("/photos/a/b.webp", 960), "/photos/a/b.w960.jpg");
  assert.equal(variantPath("/photos/a/b.avif", 640), "/photos/a/b.w640.jpg");
});

test("每个日报封面都有 640w/960w 变体（构建前 prebuild 会补，但变体要入库）", async () => {
  const root = new URL("../", import.meta.url).pathname;
  const dir = path.join(root, "src/content/invest");
  const missing: string[] = [];
  for (const name of await readdir(dir)) {
    if (!/\.mdx?$/.test(name)) continue;
    const cover = coverFromFrontmatter(await readFile(path.join(dir, name), "utf8"));
    if (!cover) continue;
    for (const width of [640, 960]) {
      const file = path.join(root, "public", decodeURIComponent(variantPath(cover, width)));
      const info = await stat(file).catch(() => null);
      if (!info) missing.push(variantPath(cover, width));
    }
  }
  assert.deepEqual(missing, []);
});
