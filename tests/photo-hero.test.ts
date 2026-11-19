import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { heroWebpSources } from "../src/lib/photo-hero.ts";

test("手机用 720px 缩略图 webp，桌面用原尺寸 webp", () => {
  const sources = heroWebpSources({ srcWebp: "/a/full.webp", thumbWebp: "/a/full.thumb.webp" });
  assert.equal(sources.mobile, "/a/full.thumb.webp");
  assert.equal(sources.desktop, "/a/full.webp");
});

test("缺变体时返回 null，由页面退化成原图（不能拼出不存在的路径）", () => {
  assert.deepEqual(heroWebpSources({ srcWebp: "/a/full.webp" }), { mobile: null, desktop: "/a/full.webp" });
  assert.deepEqual(heroWebpSources(undefined), { mobile: null, desktop: null });
  assert.deepEqual(heroWebpSources(null), { mobile: null, desktop: null });
});

test("相册页 hero 真的用上了这两个候选（防止有人把 media 分支删掉）", async () => {
  const page = await readFile(new URL("../src/pages/photo/[slug].astro", import.meta.url), "utf8");
  assert.match(page, /heroSources\.mobile/);
  assert.match(page, /heroSources\.desktop/);
  // 手机分支必须带 media 条件，否则就变成「所有屏幕都用缩略图」——桌面 hero 会糊
  assert.match(page, /heroSources\.mobile && <source type="image\/webp" media="\(max-width: 640px\)"/);
});

test("相册列表页封面必须走派生图，不许直接下原图", async () => {
  for (const file of ["../src/pages/photo/index.astro", "../src/pages/en/photo/index.astro"]) {
    const page = await readFile(new URL(file, import.meta.url), "utf8");
    // 有 picture + webp 候选
    assert.match(page, /<source type="image\/webp" srcset=\{cover\.thumbWebp\}/, file);
    // 兜底图用 1200×630 的 og.jpg，而不是原图
    assert.match(page, /src=\{cover\.srcOg \?\? cover\.src\}/, file);
    // 窄带上必须带内在宽高（不然懒加载图片会把网格顶乱）
    assert.match(page, /width=\{cover\.width \|\| undefined\}/, file);
  }
});
