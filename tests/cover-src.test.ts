import assert from "node:assert/strict";
import test from "node:test";

import { coverStem, derivedCandidates, pickLightCover } from "../src/lib/cover-src.ts";

test("只在 /photos/ 下的路径才去找派生图，其他原样返回", () => {
  assert.equal(coverStem("/photos/uploads/a/x.jpeg"), "/photos/uploads/a/x");
  assert.equal(coverStem("/og/ai/x.png"), null);
  assert.equal(coverStem(undefined), null);
  assert.equal(pickLightCover("/og/ai/x.png", () => true), "/og/ai/x.png");
  assert.equal(pickLightCover(undefined, () => true), undefined);
});

test("候选顺序按体积从轻到重（thumb.webp 优先）", () => {
  assert.deepEqual(derivedCandidates("/photos/x/foo.webp"), [
    "/photos/x/foo.thumb.webp",
    "/photos/x/foo.w640.jpg",
    "/photos/x/foo.w960.jpg",
    "/photos/x/foo.og.jpg",
  ]);
  // 原图扩展名不影响候选（webp/jpeg/png 都先剥掉）
  assert.deepEqual(derivedCandidates("/photos/x/foo.JPEG"), derivedCandidates("/photos/x/foo.png"));
});

test("有派生图用最轻的；一个都没有才退回原图（不许 404）", () => {
  const cover = "/photos/x/foo.jpeg";
  const existsAll = () => true;
  assert.equal(pickLightCover(cover, existsAll), "/photos/x/foo.thumb.webp");

  const onlyOg = (url) => url.endsWith(".og.jpg");
  assert.equal(pickLightCover(cover, onlyOg), "/photos/x/foo.og.jpg");

  const none = () => false;
  assert.equal(pickLightCover(cover, none), cover);
});

test("编码过的文件名按原样拼候选（decode 交给读盘那一层）", () => {
  const cover = "/photos/x/ChatGPT%20Image%202026%E5%B9%B46%E6%9C%883.png";
  assert.equal(derivedCandidates(cover)[0], "/photos/x/ChatGPT%20Image%202026%E5%B9%B46%E6%9C%883.thumb.webp");
});

test("cover 直接写成派生图时，也要往下换成更轻的一档", () => {
  // 线上真实情况：666 篇内容的 cover 指向 .og.jpg（1200×630），卡片跟着用最大的那张
  assert.equal(coverStem("/photos/x/foo.og.jpg"), "/photos/x/foo");
  assert.equal(coverStem("/photos/x/foo.w640.jpg"), "/photos/x/foo");
  assert.equal(coverStem("/photos/x/foo.thumb.webp"), "/photos/x/foo");
  // 名字里本来就有 og/thumb 字样的，不能被误伤
  assert.equal(coverStem("/photos/x/og-banner.jpg"), "/photos/x/og-banner");
  assert.equal(coverStem("/photos/x/thumb.webp"), "/photos/x/thumb");

  const exists = (url: string) => url.endsWith(".thumb.webp") || url.endsWith(".og.jpg");
  assert.equal(pickLightCover("/photos/x/foo.og.jpg", exists), "/photos/x/foo.thumb.webp");
  // 一个派生图都找不到时，仍要返回调用方给的那张（不许变空、不许 404）
  assert.equal(pickLightCover("/photos/x/foo.og.jpg", () => false), "/photos/x/foo.og.jpg");
});

test("首屏第一张图要 eager + high，其余仍 lazy（LCP 元素就是它）", async () => {
  const { readFile } = await import("node:fs/promises");
  const gallery = await readFile(new URL("../src/components/PhotoGallery.tsx", import.meta.url), "utf8");
  assert.match(gallery, /loading=\{i === 0 \? "eager" : "lazy"\}/, "相册首图必须 eager");
  assert.match(gallery, /fetchPriority=\{i === 0 \? "high" : "auto"\}/, "相册首图要高优先级");
  const digest = await readFile(new URL("../src/pages/ai/digest/index.astro", import.meta.url), "utf8");
  assert.match(digest, /const firstCardId = digests\[0\]\?\.id/, "第一张卡片按 id 判定，不用可变计数器");
  assert.match(digest, /loading=\{d\.id === firstCardId \? "eager" : "lazy"\}/);
  assert.match(digest, /fetchpriority=\{d\.id === firstCardId \? "high" : undefined\}/);
});
