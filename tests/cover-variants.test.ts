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

test("封面变体不能被当成照片收进相册清单", async () => {
  const { readFile } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url).pathname;
  for (const album of ["baokemeng", "hudieren"]) {
    const raw = await readFile(`${root}src/data/photo-manifest/${album}.json`, "utf8").catch(() => null);
    if (!raw) continue;
    // scripts/cover-variants.mjs 写的 .w640/.w960 是列表页用的派生图，不该出现在相册里
    assert.ok(!raw.includes(".w640.") && !raw.includes(".w960."), `${album} 清单里混进了封面变体`);
  }
  // 生成器本身也要有过滤规则，否则下次 build 又写回去
  const generator = await readFile(`${root}scripts/build-photo-manifests.ts`, "utf8");
  assert.match(generator, /\\.w\(\?:640\|960\)\\.jpg/);
});
