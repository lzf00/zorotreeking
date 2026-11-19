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
