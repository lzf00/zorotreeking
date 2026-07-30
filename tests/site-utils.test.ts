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
import { estimateReadingTime } from "../src/lib/reading-time";
import { getRelatedPosts } from "../src/lib/related-posts";
import { normalizeSameOriginUrl } from "../src/lib/safe-url";
import { getStaticSitemapPaths } from "../src/lib/sitemap";
import { normalizeVerificationToken } from "../src/lib/site-verification";
import { escapeXml } from "../src/lib/xml";

test("pathWithLang keeps Chinese at the root and prefixes English", () => {
  assert.equal(pathWithLang("/", "zh"), "/");
  assert.equal(pathWithLang("/ai", "zh"), "/ai");
  assert.equal(pathWithLang("/", "en"), "/en/");
  assert.equal(pathWithLang("/ai", "en"), "/en/ai");
});

test("language switch only appears when the alternate page exists", () => {
  assert.equal(hasAlternateLanguagePath("/ai/digest-2026-07-29"), true);
  assert.equal(hasAlternateLanguagePath("/invest/stock/000001.SZ"), true);
  assert.equal(hasAlternateLanguagePath("/invest/etf"), false);
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
  for (const page of ["stats.astro", "guestbook.astro"]) {
    const source = readFileSync(
      new URL(`../src/pages/admin/${page}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /[?&]key=/);
    assert.match(source, /"X-Admin-Token"/);
  }
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
