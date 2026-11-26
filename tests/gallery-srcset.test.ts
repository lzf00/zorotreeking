import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const MANIFEST_DIR = new URL("../src/data/photo-manifest/", import.meta.url);

test("带 thumbSm 的条目必须是 .thumb480.webp，且同时有 720w 版本", async () => {
  const files = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith(".json"));
  let with480 = 0;
  for (const file of files) {
    const entries = JSON.parse(await readFile(new URL(file, MANIFEST_DIR), "utf8"));
    for (const entry of entries) {
      if (!entry.thumbSm) continue;
      with480 += 1;
      assert.match(entry.thumbSm, /\.thumb480\.webp$/, `${file}: thumbSm 命名不对 ${entry.thumbSm}`);
      if (entry.width > 720) {
        assert.ok(entry.thumbWebp, `${file}: ${entry.src} 宽 ${entry.width} 却没有 720w 缩略图`);
      }
    }
  }
  assert.ok(with480 > 0, "至少应有一张图带 480w 缩略图");
});

test("相册网格用 srcset + sizes 而不是单一路径", async () => {
  const src = await readFile(new URL("../src/components/PhotoGallery.astro", import.meta.url), "utf8");
  // 组装逻辑收敛在 src/lib/photo-srcset.ts（真实宽度描述符由那边的单测覆盖）
  assert.match(src, /srcset=\{buildSrcSet\(galleryVariants\(p\)\)\}/, "网格 srcset 应走共用组装器");
  // sizes 必须跟列数一致：单列 100vw / 两列 50vw / 三列 33vw
  assert.match(src, /SIZES = "\(min-width: 1024px\) 33vw, \(min-width: 640px\) 50vw, 100vw"/, "sizes 要跟列数一致");
});

test("相册页不再是 React 岛：没有任何 client:* 指令（第 228 轮）", async () => {
  const gallery = await readFile(new URL("../src/components/PhotoGallery.astro", import.meta.url), "utf8");
  assert.doesNotMatch(gallery, /from "react|from 'react/, "相册组件不许再 import React");
  // 只看代码（注释里提到 client:load 是为了解释历史，不算违规）
  const codeOnly = gallery
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
  assert.doesNotMatch(codeOnly, /client:(load|idle|visible|only)/, "相册组件不该带水合指令");
  // PhotoSwipe 必须还是动态 import：静态 import 会让首屏多付 ~60 KB
  assert.match(gallery, /import\("photoswipe\/lightbox"\)/, "Lightbox 要动态导入");
  assert.match(gallery, /import\("photoswipe"\)/, "核心包要动态导入");
  // 原来的 342 KB JS 里有 202 KB 是 React 运行时，全靠这两条不再被拉进来
  for (const page of ["src/pages/photo/[slug].astro", "src/pages/en/photo/[slug].astro"]) {
    const text = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(text, /PhotoGallery\.astro/, `${page} 要引用 Astro 版相册`);
    // 相册本身不许带水合指令（地图 PhotoMap 是另一个组件，仍是 client:visible，不在此列）
    assert.doesNotMatch(text, /<PhotoGallery[^>]*client:/, `${page} 的相册不该是岛`);
  }
  // 没有 .tsx 副本，避免以后有人"顺手"改回 React
  await assert.rejects(
    readFile(new URL("../src/components/PhotoGallery.tsx", import.meta.url), "utf8"),
    "PhotoGallery.tsx 不该存在",
  );
});
