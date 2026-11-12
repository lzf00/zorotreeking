import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertEmbeddingCacheWriteSafe,
  ensureEmbeddingCacheModel,
} from "../scripts/lib/embedding";
import { hasAlternateLanguagePath, pathWithLang } from "../src/i18n/ui";
import { serializeJsonLd } from "../src/lib/json-ld";
import { selectCanonicalOgEntries } from "../src/lib/og-paths";
import { projectTo2D } from "../src/lib/pca";
import { relatedTags, tagSections } from "../src/lib/tag-relations";
import { breadcrumbJsonLd, buildBreadcrumb, splitPath } from "../src/lib/breadcrumbs";
import { estimateReadingTime } from "../src/lib/reading-time";
import { getRelatedPosts } from "../src/lib/related-posts";
import { normalizeSameOriginUrl } from "../src/lib/safe-url";
import { getStaticSitemapPaths } from "../src/lib/sitemap";
import { normalizeVerificationToken } from "../src/lib/site-verification";
import { escapeXml } from "../src/lib/xml";

test("pathWithLang keeps Chinese at the root and prefixes English", () => {
  assert.equal(pathWithLang("/", "zh"), "/");
  assert.equal(pathWithLang("/ai", "zh"), "/ai/");
  assert.equal(pathWithLang("/", "en"), "/en/");
  assert.equal(pathWithLang("/ai", "en"), "/en/ai/");
});

test("pathWithLang 补尾斜杠：站点是 directory 格式，canonical 一律带斜杠", () => {
  // 不带斜杠的写法每点一次都会 301 一次，所以导航/页脚/卡片统一走这个函数
  assert.equal(pathWithLang("/about", "zh"), "/about/");
  assert.equal(pathWithLang("/ai/digest", "en"), "/en/ai/digest/");
  assert.equal(pathWithLang("/about/", "zh"), "/about/", "已经带斜杠不能变成两个");
  assert.equal(pathWithLang("/tag/arxiv", "en"), "/en/tag/arxiv/");
});

test("pathWithLang 放过真正的静态文件，但个股代码不是文件", () => {
  assert.equal(pathWithLang("/rss.xml", "zh"), "/rss.xml");
  assert.equal(pathWithLang("/photos/a.jpg", "en"), "/en/photos/a.jpg");
  // /invest/stock/688981.SH 里带点，但它是页面路由，必须加斜杠
  assert.equal(pathWithLang("/invest/stock/688981.SH", "zh"), "/invest/stock/688981.SH/");
  assert.equal(pathWithLang("/invest/stock/0981.HK", "en"), "/en/invest/stock/0981.HK/");
});

test("language switch only appears when the alternate page exists", () => {
  assert.equal(hasAlternateLanguagePath("/ai/digest-2026-07-29"), true);
  assert.equal(hasAlternateLanguagePath("/invest/stock/000001.SZ"), true);
  assert.equal(hasAlternateLanguagePath("/invest/etf"), false);
  assert.equal(hasAlternateLanguagePath("/invest/us-market"), false);
  assert.equal(hasAlternateLanguagePath("/explore"), false);
  assert.equal(hasAlternateLanguagePath("/admin/stats"), false);
  assert.equal(hasAlternateLanguagePath("/404"), false);
});

test("estimateReadingTime always returns at least one minute", () => {
  assert.equal(estimateReadingTime(""), 1);
  assert.equal(estimateReadingTime("A short note."), 1);
});

test("projectTo2D is deterministic for reproducible builds", () => {
  const items = {
    a: { vec: [1, 0, 0] },
    b: { vec: [0, 1, 0] },
    c: { vec: [0, 0, 1] },
    d: { vec: [0.5, 0.5, 0] },
  };

  assert.deepEqual(projectTo2D(items), projectTo2D(items));
});

test("embedding caches are reset when the model changes", () => {
  const oldCache = {
    model: "old-model",
    dim: 2,
    items: { article: { hash: "abc", vec: [1, 2] } },
  };

  assert.deepEqual(
    ensureEmbeddingCacheModel(oldCache, "new-model"),
    {
      cache: { model: "new-model", dim: 0, items: {} },
      reset: true,
    },
  );
  assert.equal(ensureEmbeddingCacheModel(oldCache, "old-model").reset, false);
  assert.doesNotThrow(() => assertEmbeddingCacheWriteSafe(false, 3));
  assert.throws(
    () => assertEmbeddingCacheWriteSafe(true, 1),
    /refusing to replace the previous cache/,
  );
});

test("selectCanonicalOgEntries emits one image per translation key and prefers Chinese", () => {
  const entries = [
    { data: { translationKey: "same", lang: "en" as const, title: "English" } },
    { data: { translationKey: "same", lang: "zh" as const, title: "中文" } },
    { data: { translationKey: "english-only", lang: "en" as const, title: "Only" } },
  ];

  const selected = selectCanonicalOgEntries(entries);
  assert.deepEqual(
    selected.map((entry) => [entry.data.translationKey, entry.data.title]),
    [
      ["same", "中文"],
      ["english-only", "Only"],
    ],
  );
});

test("static sitemap covers public utility pages and excludes admin tools", () => {
  const paths = getStaticSitemapPaths();
  assert.ok(paths.includes("/subscribe"));
  assert.ok(paths.includes("/guestbook"));
  assert.ok(paths.includes("/invest/etf"));
  assert.ok(paths.includes("/en/privacy"));
  assert.equal(paths.some((path) => path.startsWith("/admin")), false);
  assert.equal(new Set(paths).size, paths.length);
});

test("site verification variables accept tokens and recover from pasted meta tags", () => {
  assert.equal(
    normalizeVerificationToken("google_token-123"),
    "google_token-123",
  );
  assert.equal(
    normalizeVerificationToken('<meta name="google-site-verification" content="google_token-123" />'),
    "google_token-123",
  );
  assert.equal(normalizeVerificationToken("<script>alert(1)</script>"), undefined);
  assert.equal(normalizeVerificationToken(""), undefined);
});

test("admin pages keep secrets out of request URLs", () => {
  for (const page of ["stats.astro", "guestbook.astro", "etf-ops.astro"]) {
    const source = readFileSync(
      new URL(`../src/pages/admin/${page}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /[?&]key=/);
    assert.match(source, /"X-Admin-Token"/);
  }
});

test("navbar keeps the authenticated CMS entry discoverable", () => {
  const source = readFileSync(
    new URL("../src/components/Navbar.astro", import.meta.url),
    "utf8",
  );

  assert.equal(source.match(/href="\/admin\/"/g)?.length, 2);
  assert.match(source, /aria-label=\{t\("nav\.admin"\)\}/);
  assert.match(source, /\{t\("nav\.admin"\)\}/);
});

test("JSON-LD serialization cannot terminate its script element", () => {
  const serialized = serializeJsonLd({
    headline: "</script><script>alert('xss')</script>",
    separator: "\u2028",
  });

  assert.doesNotMatch(serialized, /<\/script/i);
  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.match(serialized, /\\u2028/);
  assert.deepEqual(JSON.parse(serialized), {
    headline: "</script><script>alert('xss')</script>",
    separator: "\u2028",
  });
});

test("same-origin media URLs reject external and executable protocols", () => {
  const origin = "https://www.zorotreeking.online";
  assert.equal(
    normalizeSameOriginUrl("/photos/image 1.jpg?size=large#preview", origin),
    "/photos/image%201.jpg?size=large#preview",
  );
  assert.equal(normalizeSameOriginUrl("https://evil.example/x.jpg", origin), "#");
  assert.equal(normalizeSameOriginUrl("//evil.example/x.jpg", origin), "#");
  assert.equal(normalizeSameOriginUrl("javascript:alert(1)", origin), "#");
  assert.equal(normalizeSameOriginUrl("http://[", origin), "#");
});

test("ratings are only persisted after the backend accepts them", () => {
  const source = readFileSync(
    new URL("../src/components/StarRating.tsx", import.meta.url),
    "utf8",
  );
  const postIndex = source.indexOf("await postFeedback");
  const storageIndex = source.indexOf("localStorage.setItem", postIndex);
  assert.ok(postIndex >= 0);
  assert.ok(storageIndex > postIndex);
});

test("related posts retain semantic matches while filling remaining slots", () => {
  const post = (
    collection: string,
    translationKey: string,
    date: string,
    tags: string[],
  ) => ({
    collection,
    body: "",
    data: {
      translationKey,
      title: translationKey,
      date: new Date(date),
      tags,
    },
  });
  const current = post("ai", "current", "2026-07-29", ["shared"]);
  const semantic = post("invest", "semantic", "2025-01-01", []);
  const taggedNew = post("ai", "tagged-new", "2026-07-28", ["shared"]);
  const taggedOld = post("ai", "tagged-old", "2026-07-27", ["shared"]);

  const related = getRelatedPosts(
    current,
    [current, semantic, taggedOld, taggedNew],
    3,
    {
      model: "test",
      dim: 2,
      items: {
        "ai/current": { hash: "a", vec: [1, 0] },
        "invest/semantic": { hash: "b", vec: [1, 0] },
      },
    },
  );

  assert.deepEqual(
    related.map((item) => item.translationKey),
    ["semantic", "tagged-new", "tagged-old"],
  );
});

test("XML escaping protects generated feed and sitemap values", () => {
  assert.equal(
    escapeXml(`https://example.test/?a=1&b=<tag>"'`),
    "https://example.test/?a=1&amp;b=&lt;tag&gt;&quot;&apos;",
  );
});

test("relatedTags 按共现次数排序，且排除标签自身", () => {
  const posts = [
    { section: "ai" as const, tags: ["astro", "ssg", "meta"] },
    { section: "ai" as const, tags: ["astro", "ssg"] },
    { section: "photo" as const, tags: ["astro", "photo"] },
  ];
  const related = relatedTags("astro", posts);
  assert.deepEqual(
    related.map((r) => `${r.tag}:${r.count}`),
    ["ssg:2", "meta:1", "photo:1"],
    "共现 2 次的排前面，同次数按名称排序，且不包含 astro 自己",
  );
  assert.equal(related[0].slug, "ssg", "slug 与 URL 用的是同一套规则");
});

test("relatedTags 对单个标签、空标签列表都不炸", () => {
  assert.deepEqual(relatedTags("astro", [{ section: "ai", tags: ["astro"] }]), []);
  assert.deepEqual(relatedTags("astro", []), []);
  // 空字符串标签不应被当成一个「共现标签」
  assert.deepEqual(relatedTags("astro", [{ section: "ai", tags: ["astro", ""] }]), []);
});

test("relatedTags 尊重 limit，并按名称稳定排序", () => {
  const posts = [{ section: "hike" as const, tags: ["x", "b", "a"] }];
  assert.deepEqual(relatedTags("x", posts, 1).map((r) => r.tag), ["a"]);
  assert.deepEqual(relatedTags("x", posts).map((r) => r.tag), ["a", "b"]);
});

test("tagSections 按固定栏目顺序返回，不重复", () => {
  const posts = [
    { section: "hike" as const, tags: [] },
    { section: "ai" as const, tags: [] },
    { section: "ai" as const, tags: [] },
  ];
  assert.deepEqual(tagSections(posts), ["ai", "hike"], "顺序固定为 ai、invest、photo、hike");
  assert.deepEqual(tagSections([]), []);
});

test("中文标签的 slug 与 URL 保持一致（encodeURIComponent）", () => {
  // 标签页文件名用的是 encodeURIComponent 后的结果，两者必须一直对得上
  assert.equal(relatedTags("投资", [{ section: "invest", tags: ["投资", "复盘 2026"] }])[0].slug, encodeURIComponent("复盘-2026"));
});

test("面包屑：标签页插入「全部标签」一级", () => {
  const crumbs = buildBreadcrumb({
    pathname: "/tag/photo/", lang: "zh", title: "标签: #photo",
    labels: { home: "首页", allTags: "全部标签", sections: { ai: "AI 学习", invest: "个人投资", photo: "摄影", hike: "徒步旅行" } },
  });
  assert.deepEqual(crumbs, [
    { name: "首页", path: "/" },
    { name: "全部标签", path: "/tag/" },
    { name: "标签: #photo" },
  ]);
});

test("面包屑：板块子页插一级栏目，英文带 /en 前缀", () => {
  const labels = { home: "Home", allTags: "All tags", sections: { photo: "Photography" } };
  assert.deepEqual(buildBreadcrumb({ pathname: "/en/photo/baokemeng/", lang: "en", title: "Pokémon", labels }), [
    { name: "Home", path: "/en/" },
    { name: "Photography", path: "/en/photo/" },
    { name: "Pokémon" },
  ]);
  // 板块首页自己只有两级
  assert.deepEqual(buildBreadcrumb({ pathname: "/photo/", lang: "zh", title: "摄影", labels: { home: "首页", allTags: "全部标签", sections: { photo: "摄影" } } }), [
    { name: "首页", path: "/" },
    { name: "摄影" },
  ]);
});

test("面包屑：静态页只有首页 + 当前页，首页返回 null", () => {
  const labels = { home: "首页", allTags: "全部标签", sections: {} };
  assert.deepEqual(buildBreadcrumb({ pathname: "/privacy/", lang: "zh", title: "隐私政策", labels }), [
    { name: "首页", path: "/" },
    { name: "隐私政策" },
  ]);
  assert.equal(buildBreadcrumb({ pathname: "/", lang: "zh", title: "首页", labels }), null);
  assert.equal(buildBreadcrumb({ pathname: "/en/", lang: "en", title: "Home", labels }), null);
});

test("面包屑 JSON-LD：末级不带 item，position 从 1 开始", () => {
  const ld = breadcrumbJsonLd(
    [{ name: "首页", path: "/" }, { name: "摄影", path: "/photo/" }, { name: "宝可梦" }],
    "https://www.zorotreeking.online",
  );
  assert.equal(ld["@type"], "BreadcrumbList");
  assert.deepEqual(ld.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.equal(ld.itemListElement[0].item, "https://www.zorotreeking.online/");
  assert.equal("item" in ld.itemListElement[2], false, "末级是当前页，不带 item");
});

test("splitPath 去掉语言前缀、尾斜杠与查询串", () => {
  assert.deepEqual(splitPath("/en/invest/stock/0700.HK/"), ["invest", "stock", "0700.HK"]);
  assert.deepEqual(splitPath("/tag/photo/?x=1"), ["tag", "photo"]);
  assert.deepEqual(splitPath("/"), []);
});
