import assert from "node:assert/strict";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error 组件/工具模块走 Vite 别名，测试里按结构化数据断言
const { pickAlbumCover } = await import("../src/lib/photo-cover.ts");

const photo = (name: string, width = 1200) => ({
  src: `/photos/uploads/a/${encodeURIComponent(name)}`,
  thumb: `/photos/uploads/a/${encodeURIComponent(name).replace(/\.jpe?g$/i, ".thumb.webp")}`,
  width,
  height: 800,
  alt: name,
});

const photos = [photo("one.jpg"), photo("two.jpg"), photo("three.jpg")];

test("没有 cover 字段时用第一张，其余进网格", () => {
  const r = pickAlbumCover(undefined, photos, "t");
  assert.equal(r.cover?.src, photos[0].src);
  assert.deepEqual(r.rest.map((p: { src: string }) => p.src), [photos[1].src, photos[2].src]);
});

test("cover 命中 manifest 条目时按 src 比对，并且该张不重复进网格", () => {
  // frontmatter 里写的是未编码路径（文件名带空格/中文时一定对不上原样比较）
  const coverPath = "/photos/uploads/a/two.jpg";
  const r = pickAlbumCover(coverPath, photos, "t");
  assert.equal(r.cover?.src, photos[1].src);
  assert.equal(r.rest.length, 2);
  assert.ok(!r.rest.some((p: { src: string }) => p.src === photos[1].src));
});

test("cover 不在 manifest 里时退化成裸路径，网格保留全部照片", () => {
  const r = pickAlbumCover("/photos/uploads/a/outside.png", photos, "标题");
  assert.equal(r.cover?.src, "/photos/uploads/a/outside.png");
  assert.equal(r.cover?.alt, "标题");
  assert.equal(r.rest.length, 3);
});

test("空相册返回 null 封面", () => {
  const r = pickAlbumCover("/x.jpg", [], "t");
  assert.equal(r.cover, null);
  assert.deepEqual(r.rest, []);
});

test("中英文相册页共用同一个选封面函数（防止再次漂移）", async () => {
  const { readFile } = await import("node:fs/promises");
  const zh = await readFile(new URL("../src/pages/photo/[slug].astro", import.meta.url), "utf8");
  const en = await readFile(new URL("../src/pages/en/photo/[slug].astro", import.meta.url), "utf8");
  for (const [name, src] of [["zh", zh], ["en", en]] as const) {
    assert.match(src, /import \{ pickAlbumCover \} from "@\/lib\/photo-cover"/, `${name} 页应引用共用函数`);
    assert.match(src, /pickAlbumCover\(entry\.data\.cover, photos, entry\.data\.title\)/, `${name} 页调用参数应一致`);
    assert.doesNotMatch(src, /const cover = photos\[0\]/, `${name} 页不要再写死 photos[0]`);
    // 社交卡片裁切图不能当原图 src
    assert.doesNotMatch(src, /src=\{cover\.srcOg/, `${name} 页的 <img src> 不能用 srcOg`);
  }
});
