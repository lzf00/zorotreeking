/**
 * 英文文章页必须说明「这是机翻」（第 211 轮）。
 *
 * 全站 537 篇英文文章都由脚本从中文稿翻译而来。第 121 轮只处理了"英文页里还剩大段
 * 中文"的情况，而**干净的**机翻更危险：通顺到读者以为措辞是作者选的。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { MACHINE_TRANSLATION_NOTICE, zhCounterpartPath } from "../src/lib/i18n-leaks";
import { articleNodes, hasNotice, judge } from "../scripts/check-translation-notice.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const page = (route: string, extra = "") =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"x"${extra}}</script>`;

test("英文路径能换回中文原文路径", () => {
  assert.equal(zhCounterpartPath("/en/ai/digest-2026-11-25/"), "/ai/digest-2026-11-25/");
  assert.equal(zhCounterpartPath("/en/invest/market-recap-2026-11-25/"), "/invest/market-recap-2026-11-25/");
  assert.equal(zhCounterpartPath("/en/hike/sample-route/"), "/hike/sample-route/");
});

test("非英文路径不给对照（中文页没有「原文」可指）", () => {
  for (const p of ["/ai/digest-2026-11-25/", "/", "/photo/baokemeng/", "/en", "/zh/ai/foo/"]) {
    assert.equal(zhCounterpartPath(p), null, p);
  }
  // /en/ 是英文首页，中文原文就是首页 —— 这是唯一合法的一对
  assert.equal(zhCounterpartPath("/en/"), "/");
});

test("声明是一句完整的话，且不冒充人工翻译", () => {
  assert.match(MACHINE_TRANSLATION_NOTICE, /machine-translated/i);
  assert.match(MACHINE_TRANSLATION_NOTICE, /Chinese original/);
  assert.match(MACHINE_TRANSLATION_NOTICE, /authoritative/, "要说明以中文版为准");
});

test("judge：英文文章缺声明 / 缺 translationOfWork 都要报；中文页误标也要报", () => {
  const good = judge([
    {
      route: "/en/ai/digest-2026-11-25/",
      html:
        page("/en/ai/digest-2026-11-25/", ',"translationOfWork":{"@id":"/ai/digest-2026-11-25/"}') +
        '<p data-machine-translation="1" data-pagefind-ignore></p>',
    },
  ]);
  assert.deepEqual(good.violations, []);
  assert.equal(good.checked, 1);

  const missingNotice = judge([{ route: "/en/ai/foo/", html: page("x", ',"translationOfWork":{}') }]);
  assert.equal(missingNotice.violations.length, 1);
  assert.match(missingNotice.violations[0].problem, /没有机翻声明/);

  const indexed = judge([{ route: "/en/ai/foo/", html: page("x", ',"translationOfWork":{}') + '<p data-machine-translation="1"></p>' }]);
  assert.equal(indexed.violations.length, 1);
  assert.match(indexed.violations[0].problem, /搜索索引/);

  const missingWork = judge([{ route: "/en/ai/foo/", html: page("x") + '<p data-machine-translation="1" data-pagefind-ignore></p>' }]);
  assert.match(missingWork.violations[0].problem, /translationOfWork/);

  const zhMislabeled = judge([
    { route: "/ai/foo/", html: page("x") + '<p data-machine-translation="1" data-pagefind-ignore></p>' },
  ]);
  assert.equal(zhMislabeled.violations.length, 1);
  assert.match(zhMislabeled.violations[0].problem, /中文原文页被标成机翻/);
});

test("列表页/索引页没有 Article JSON-LD，不参与判定", () => {
  const { violations, checked } = judge([
    { route: "/en/ai/", html: "<html><body>list</body></html>" },
    { route: "/en/invest/digest/2/", html: "<html><body>archive</body></html>" },
  ]);
  assert.deepEqual(violations, []);
  assert.equal(checked, 0);
});

test("三个英文文章模板都挂了声明组件，并且带中文原文入口", async () => {
  for (const rel of ["src/pages/en/ai/[slug].astro", "src/pages/en/invest/[slug].astro", "src/pages/en/hike/[slug].astro"]) {
    const src = await read(rel);
    assert.match(src, /TranslationNotice/, `${rel} 没挂声明组件`);
    assert.match(src, /zhCounterpartPath/, `${rel} 没算中文原文地址`);
  }
});

test("BaseLayout 给英文文章写 translationOfWork，中文页不写", async () => {
  const src = await read("src/layouts/BaseLayout.astro");
  assert.match(src, /zhCounterpartPath/);
  assert.match(src, /translationOfWork/);
  assert.match(src, /\.\.\.\(zhCounterpart/);
});

test("articleNodes / hasNotice 读真实 HTML 片段", () => {
  assert.equal(articleNodes(page("x")).length, 1);
  assert.equal(articleNodes("<html></html>").length, 0);
  assert.equal(articleNodes('<script type="application/ld+json">{"@type":"WebSite"}</script>').length, 0);
  assert.equal(hasNotice('<p data-machine-translation="1">'), true);
  assert.equal(hasNotice('<p data-machine-translation="0">'), false);
});

test("机翻声明不进搜索索引", async () => {
  const { noticeIsIgnored } = await import("../scripts/check-translation-notice.mjs");
  assert.equal(noticeIsIgnored('<p data-machine-translation="1" data-pagefind-ignore>…</p>'), true);
  assert.equal(noticeIsIgnored('<p data-machine-translation="1">…</p>'), false);
  assert.equal(noticeIsIgnored("<p>无</p>"), null);

  const component = await read("src/components/TranslationNotice.astro");
  assert.match(component, /data-pagefind-ignore/);
});
