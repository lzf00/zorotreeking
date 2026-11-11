import assert from "node:assert/strict";
import test from "node:test";

import { coverByTranslationKey, ogDerivative, resolveSocialImage } from "../src/lib/social-image";

// 2026-11 的真实事故：英文投资日报 40 篇机器翻译稿没有 cover，
// og:image 落到从没生成过的 /og/invest/<slug>.png，社交卡片全都没有图。
test("social image falls back to the site card instead of a 404 path", () => {
  const resolved = resolveSocialImage(["/og/invest/digest-2099-01-01.png"]);
  assert.equal(resolved.src, "/og-default.png");
  assert.equal(resolved.width, 1200);
  assert.equal(resolved.height, 630);
});

test("social image prefers the 1200x630 derivative when it exists", () => {
  // public/ 里真实存在的原图 + 派生图
  const original = "/photos/uploads/hudieren/13408098752635440.jpeg";
  assert.equal(ogDerivative(original), "/photos/uploads/hudieren/13408098752635440.og.jpg");
  const resolved = resolveSocialImage([original]);
  assert.equal(resolved.src, "/photos/uploads/hudieren/13408098752635440.og.jpg");
  assert.equal(resolved.width, 1200);
  assert.equal(resolved.height, 630);
  assert.equal(resolved.substituted, true);
});

test("social image keeps a real original when no derivative was generated", () => {
  // 675×1200 的竖图：宽度不到 1000，照片管线不给它生成 .og.jpg
  const original = "/photos/uploads/baokemeng/baokemeng-37.jpg";
  assert.equal(ogDerivative(original), null);
  const resolved = resolveSocialImage([original], { width: 675, height: 1200 });
  assert.equal(resolved.src, original);
  assert.equal(resolved.width, 675);
  assert.equal(resolved.height, 1200);
  assert.equal(resolved.substituted, false);
});

test("social image accepts external URLs untouched", () => {
  const resolved = resolveSocialImage(["https://cdn.example.com/a.png"]);
  assert.equal(resolved.src, "https://cdn.example.com/a.png");
  assert.equal(resolved.substituted, false);
});

test("social image walks the candidate list in order", () => {
  const resolved = resolveSocialImage([undefined, "", "/nope/missing.jpg", "/photos/uploads/baokemeng/baokemeng-01.jpg"]);
  assert.equal(resolved.src, "/photos/uploads/baokemeng/baokemeng-01.og.jpg");
});

test("cover map lets translated posts borrow the other language's cover", () => {
  const map = coverByTranslationKey([
    { data: { translationKey: "digest-2099-01-01", cover: "/photos/x.og.jpg" } },
    { data: { translationKey: "digest-2099-01-01", cover: null } },
    { data: { translationKey: "digest-2099-01-02" } },
  ]);
  assert.equal(map.get("digest-2099-01-01"), "/photos/x.og.jpg");
  assert.equal(map.has("digest-2099-01-02"), false);
});
