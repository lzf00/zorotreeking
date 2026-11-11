import assert from "node:assert/strict";
import test from "node:test";

import { coverByTranslationKey, ogDerivative, resolveSocialImage } from "../src/lib/social-image";

// 这组用例故意**不读磁盘**：.og.jpg 派生图是照片管线生成的、而且在 .gitignore 里，
// CI 的 "Unit and guard tests" 跑在 "Build photo manifests" 之前，
// 依赖产物会让测试时红时绿（2026-11 就这样红掉过一次部署）。
const assets = (...files: string[]) => {
  const set = new Set(files);
  return (src: string) => set.has(src);
};

// 2026-11 的真实事故：英文投资日报 40 篇机器翻译稿没有 cover，
// og:image 落到从没生成过的 /og/invest/<slug>.png，社交卡片全都没有图。
test("social image falls back to the site card instead of a 404 path", () => {
  const resolved = resolveSocialImage(["/og/invest/digest-2099-01-01.png"], undefined, assets());
  assert.equal(resolved.src, "/og-default.png");
  assert.equal(resolved.width, 1200);
  assert.equal(resolved.height, 630);
});

test("social image prefers the 1200x630 derivative when it exists", () => {
  const original = "/photos/uploads/hudieren/13408098752635440.jpeg";
  const derivative = "/photos/uploads/hudieren/13408098752635440.og.jpg";
  const exists = assets(original, derivative);
  assert.equal(ogDerivative(original, exists), derivative);

  const resolved = resolveSocialImage([original], undefined, exists);
  assert.equal(resolved.src, derivative);
  assert.equal(resolved.width, 1200);
  assert.equal(resolved.height, 630);
  assert.equal(resolved.substituted, true);
});

test("social image keeps a real original when no derivative was generated", () => {
  // 675×1200 的竖图：宽度不到 1000，照片管线不给它生成 .og.jpg
  const original = "/photos/uploads/baokemeng/baokemeng-37.jpg";
  const exists = assets(original);
  assert.equal(ogDerivative(original, exists), null);

  const resolved = resolveSocialImage([original], { width: 675, height: 1200 }, exists);
  assert.equal(resolved.src, original);
  assert.equal(resolved.width, 675);
  assert.equal(resolved.height, 1200);
  assert.equal(resolved.substituted, false);
});

test("social image accepts external URLs untouched", () => {
  const resolved = resolveSocialImage(["https://cdn.example.com/a.png"], undefined, assets());
  assert.equal(resolved.src, "https://cdn.example.com/a.png");
  assert.equal(resolved.substituted, false);
});

test("social image walks the candidate list in order", () => {
  const resolved = resolveSocialImage(
    [undefined, "", "/nope/missing.jpg", "/photos/uploads/baokemeng/baokemeng-01.jpg"],
    undefined,
    assets("/photos/uploads/baokemeng/baokemeng-01.jpg", "/photos/uploads/baokemeng/baokemeng-01.og.jpg"),
  );
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
