import assert from "node:assert/strict";
import test from "node:test";

import { collectDownloadedImages, findOversized, srcsetUrls } from "../scripts/check-image-budget.mjs";

test("srcset 解析：带描述符、空格、编码都能取到 URL", () => {
  assert.deepEqual(srcsetUrls("/a.jpg 640w, /b.jpg 960w"), ["/a.jpg", "/b.jpg"]);
  assert.deepEqual(srcsetUrls("/a.jpg"), ["/a.jpg"]);
  assert.deepEqual(srcsetUrls(""), []);
  assert.deepEqual(srcsetUrls(undefined), []);
});

test("picture 里有 webp source 时，img src 只当兜底，不算下载", () => {
  const html = `<picture>
    <source type="image/webp" srcset="/photos/uploads/x/foo.thumb.webp" />
    <img src="/photos/uploads/x/foo.jpeg" />
  </picture>`;
  const urls = collectDownloadedImages(html);
  assert.deepEqual(urls, ["/photos/uploads/x/foo.thumb.webp"]);
});

test("picture 里没有 webp source 时，img src 算真下载", () => {
  const html = `<picture><img src="/photos/uploads/x/foo.jpeg" /></picture>`;
  assert.deepEqual(collectDownloadedImages(html), ["/photos/uploads/x/foo.jpeg"]);
});

test("裸 img（不在 picture 里）算真下载，srcset 也要算", () => {
  const html = `<img src="/photos/uploads/x/a.jpeg" srcset="/photos/uploads/x/a.jpeg 1x, /photos/uploads/x/b.jpeg 2x" />`;
  const urls = collectDownloadedImages(html);
  assert.deepEqual(urls, ["/photos/uploads/x/a.jpeg", "/photos/uploads/x/a.jpeg", "/photos/uploads/x/b.jpeg"]);
});

test("超限判定：只报非派生图、按体积降序、同页同图去重", () => {
  const entries = [
    { page: "a.html", urls: ["/photos/uploads/x/big.jpeg", "/photos/uploads/x/small.jpeg", "/photos/uploads/x/big.jpeg"] },
    { page: "b.html", urls: ["/photos/uploads/x/big.thumb.webp", "/photos/uploads/x/big2.jpeg", "/og/a.png"] },
  ];
  const sizes = {
    "/photos/uploads/x/big.jpeg": 3_700_000,
    "/photos/uploads/x/small.jpeg": 40_000,
    "/photos/uploads/x/big.thumb.webp": 60_000,
    "/photos/uploads/x/big2.jpeg": 900_000,
  };
  const violations = findOversized(entries, (url) => sizes[url] ?? null, 300 * 1024);
  assert.deepEqual(
    violations.map((v) => [v.page, v.url, v.bytes]),
    [
      ["a.html", "/photos/uploads/x/big.jpeg", 3_700_000],
      ["b.html", "/photos/uploads/x/big2.jpeg", 900_000],
    ],
  );
});

test("派生图后缀一律放行（thumb/hero/og/w640/w960）", () => {
  const urls = [
    "/photos/uploads/x/a.thumb.webp",
    "/photos/uploads/x/a.hero.webp",
    "/photos/uploads/x/a.og.jpg",
    "/photos/uploads/x/a.w640.jpg",
    "/photos/uploads/x/a.w960.jpg",
  ];
  const violations = findOversized([{ page: "p.html", urls }], () => 999_999, 300 * 1024);
  assert.deepEqual(violations, []);
});

test("读不到文件（缺失/编码问题）时跳过，不误报", () => {
  const violations = findOversized([{ page: "p.html", urls: ["/photos/uploads/x/missing.jpeg"] }], () => null, 1024);
  assert.deepEqual(violations, []);
});
