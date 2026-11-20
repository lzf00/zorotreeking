import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSrcSet, coverVariants, galleryVariants } from "../src/lib/photo-srcset.ts";

test("按宽度升序、去重、忽略没有 URL 的候选", () => {
  const out = buildSrcSet([
    { url: "/a/hero.webp", width: 1600 },
    { url: "/a/sm.webp", width: 480 },
    { url: null, width: 720 },
    { url: "/a/hero.webp", width: 1600 },
  ]);
  assert.equal(out, "/a/sm.webp 480w, /a/hero.webp 1600w");
});

test("描述符用真实宽度：原图本来就窄时不能虚标", () => {
  const g = galleryVariants({ thumbWebp: "/a/t.webp", thumbSm: "/a/t480.webp", width: 600 });
  assert.equal(buildSrcSet(g), "/a/t480.webp 480w, /a/t.webp 600w");
});

test("封面候选：有 hero 时最高一档是 min(1600, 原宽)，没有 hero 时退回原尺寸 webp", () => {
  const withHero = coverVariants({
    thumbSm: "/a/sm.webp",
    thumbWebp: "/a/t.webp",
    heroWebp: "/a/hero.webp",
    srcWebp: "/a/full.webp",
    width: 3840,
  });
  assert.equal(buildSrcSet(withHero), "/a/sm.webp 480w, /a/t.webp 720w, /a/hero.webp 1600w");

  const noHero = coverVariants({ thumbWebp: "/b/t.webp", srcWebp: "/b/full.webp", width: 1080 });
  assert.equal(buildSrcSet(noHero), "/b/t.webp 720w, /b/full.webp 1080w");
});

test("相册索引页：手机档必须限死在 480/720（否则 2x 手机会拉 1600px hero）", async () => {
  for (const page of ["../src/pages/photo/index.astro", "../src/pages/en/photo/index.astro"]) {
    const src = await readFile(new URL(page, import.meta.url), "utf8");
    // 手机分支：media ≤640 + 把 hero/srcWebp 排除掉
    assert.match(src, /media="\(max-width: 640px\)"/, `${page}: 缺手机档 media`);
    assert.match(src, /heroWebp: null, srcWebp: null/, `${page}: 手机档没有排除 hero（会拉大图）`);
    // 宽屏分支：带描述符的候选，而不是单候选 srcset
    assert.match(src, /srcset=\{buildSrcSet\(coverVariants\(cover\)\)\}/, `${page}: 宽屏档应带宽度描述符`);
  }
});
