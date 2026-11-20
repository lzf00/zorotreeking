import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { heroSrcSets, heroWebpSources } from "../src/lib/photo-hero.ts";

test("手机用 720px 缩略图 webp，桌面用原尺寸 webp", () => {
  const sources = heroWebpSources({ srcWebp: "/a/full.webp", thumbWebp: "/a/full.thumb.webp" });
  assert.equal(sources.mobile, "/a/full.thumb.webp");
  assert.equal(sources.desktop, "/a/full.webp");
});

test("有 1600px 的 hero 变体时优先用它，没有才退回原尺寸 webp", () => {
  // 3840×2160 的原尺寸 webp 是 903 KB，1600px 版本 188 KB；hero 最多按 1280 CSS px 显示
  const withHero = heroWebpSources({
    heroWebp: "/a/full.hero.webp",
    srcWebp: "/a/full.webp",
    thumbWebp: "/a/full.thumb.webp",
  });
  assert.equal(withHero.desktop, "/a/full.hero.webp");
  assert.equal(withHero.mobile, "/a/full.thumb.webp");

  const withoutHero = heroWebpSources({ srcWebp: "/b/full.webp", thumbWebp: "/b/full.thumb.webp" });
  assert.equal(withoutHero.desktop, "/b/full.webp");
});

test("缺变体时返回 null，由页面退化成原图（不能拼出不存在的路径）", () => {
  assert.deepEqual(heroWebpSources({ srcWebp: "/a/full.webp" }), { mobile: null, desktop: "/a/full.webp" });
  assert.deepEqual(heroWebpSources(undefined), { mobile: null, desktop: null });
  assert.deepEqual(heroWebpSources(null), { mobile: null, desktop: null });
});

test("相册页 hero 真的用上了两档候选（防止有人把 media 分支删掉）", async () => {
  for (const file of ["../src/pages/photo/[slug].astro", "../src/pages/en/photo/[slug].astro"]) {
    const page = await readFile(new URL(file, import.meta.url), "utf8");
    // 手机档只给 480/720（media 限死），宽屏档带描述符让浏览器按 DPR 挑
    assert.match(page, /heroSets\.mobile && <source type="image\/webp" media="\(max-width: 640px\)"/, file);
    assert.match(page, /heroSets\.wide && <source type="image\/webp" srcset=\{heroSets\.wide\}/, file);
  }
});

test("hero 宽屏档必须含 1200w 中间档，否则平板/小笔记本只能拉 1600", async () => {
  const wide = heroSrcSets({
    thumbWebp: "/a/t.webp",
    thumbSm: "/a/t480.webp",
    midWebp: "/a/mid.webp",
    heroWebp: "/a/hero.webp",
    width: 3840,
  }).wide;
  assert.match(wide, /\/a\/mid\.webp 1200w/);
  assert.match(wide, /\/a\/hero\.webp 1600w/);
});

test("相册列表页封面必须走派生图，不许直接下原图", async () => {
  for (const file of ["../src/pages/photo/index.astro", "../src/pages/en/photo/index.astro"]) {
    const page = await readFile(new URL(file, import.meta.url), "utf8");
    // picture + 两档 webp source：
    //   手机档用 media 限死 480/720（不能把 1600px hero 放进手机候选，2x 手机会拉 317 KB）
    //   宽屏档带真实宽度描述符，由浏览器按屏宽 × DPR 挑
    assert.match(page, /type="image\/webp"/, file);
    assert.match(page, /media="\(max-width: 640px\)"/, file);
    assert.match(page, /heroWebp: null, srcWebp: null, midWebp: null/, file);
    assert.match(page, /srcset=\{buildSrcSet\(coverVariants\(cover\)\)\}/, file);
    // 兜底图用 1200×630 的 og.jpg，而不是原图
    assert.match(page, /src=\{cover\.srcOg \?\? cover\.src\}/, file);
    // 窄带上必须带内在宽高（不然懒加载图片会把网格顶乱）
    assert.match(page, /width=\{cover\.width \|\| undefined\}/, file);
  }
});
