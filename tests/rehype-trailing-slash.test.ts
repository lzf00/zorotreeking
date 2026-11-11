/**
 * 正文里的站内链接也要补尾斜杠：日报条目、周报列表、手写文章里的链接都走这个插件。
 * 全站曾有 49,883 处链接因为没有尾斜杠而多走一次 301。
 */
import assert from "node:assert/strict";
import test from "node:test";

import rehypeTrailingSlash, { normalizeInternalHref } from "../src/lib/rehype-trailing-slash.mjs";

test("页面链接补尾斜杠", () => {
  assert.equal(normalizeInternalHref("/invest/digest-2026-11-01"), "/invest/digest-2026-11-01/");
  assert.equal(normalizeInternalHref("/about"), "/about/");
  assert.equal(normalizeInternalHref("/tag/arxiv"), "/tag/arxiv/");
});

test("已经带斜杠、静态文件、外链都不动", () => {
  assert.equal(normalizeInternalHref("/about/"), "/about/");
  assert.equal(normalizeInternalHref("/rss.xml"), "/rss.xml");
  assert.equal(normalizeInternalHref("/photos/uploads/x.webp"), "/photos/uploads/x.webp");
  assert.equal(normalizeInternalHref("https://example.com/about"), "https://example.com/about");
  assert.equal(normalizeInternalHref("#section"), "#section");
  assert.equal(normalizeInternalHref("mailto:a@b.c"), "mailto:a@b.c");
});

test("query 与 hash 保留", () => {
  assert.equal(
    normalizeInternalHref("/ai/digest-2026-11-01?utm_source=related"),
    "/ai/digest-2026-11-01/?utm_source=related",
  );
  assert.equal(normalizeInternalHref("/invest/market#top"), "/invest/market/#top");
});

test("插件遍历整棵树，只改 <a> 的 href", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: "/invest/digest-2026-11-01" },
            children: [{ type: "text", value: "日报" }],
          },
          {
            type: "element",
            tagName: "img",
            properties: { src: "/about" },
            children: [],
          },
        ],
      },
    ],
  };
  rehypeTrailingSlash()(tree);
  const [paragraph] = tree.children;
  assert.equal(paragraph.children[0].properties.href, "/invest/digest-2026-11-01/");
  assert.equal(paragraph.children[1].properties.src, "/about", "img 的 src 不该被改写");
});
