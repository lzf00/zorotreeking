/**
 * 零入链页面检查（第 204 轮）。
 *
 * 页面没有站内链接指向它 = 读者到不了、爬虫只能靠 sitemap。本轮量了一次：1293 页、
 * 47224 条站内链接，零入链 6 个，其中 4 个是 /404.html 与 /admin/*（本就不该有入链），
 * 2 个是旧的 /photography/ 跳转桩（noindex + meta refresh）。
 * 也就是说当前**没有真正的孤儿页** —— 把这条事实变成常设闸门，防止哪天新加内容类型忘了接索引。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { inboundCounts, isIndexable, isRedirectStub, normalizeHref, orphans, pagePathOf } from "../scripts/check-orphans.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("normalizeHref：去查询串/锚点、补斜杠、排掉静态与接口", () => {
  assert.equal(normalizeHref("/photo/#top"), "/photo/");
  assert.equal(normalizeHref("/archive/?page=2"), "/archive/");
  assert.equal(normalizeHref("/tag/etf"), "/tag/etf/");
  assert.equal(normalizeHref("/atom.xml"), "/atom.xml", "带扩展名的不补斜杠");
  assert.equal(normalizeHref("/_astro/x.js"), null);
  assert.equal(normalizeHref("/pagefind/pagefind.js"), null);
  assert.equal(normalizeHref("/api/market/cn"), null);
  assert.equal(normalizeHref("https://example.com/x"), null);
  assert.equal(normalizeHref("#section"), null);
});

test("pagePathOf：目录页与根页", () => {
  assert.equal(pagePathOf("dist", "dist/index.html"), "/");
  assert.equal(pagePathOf("dist", "dist/invest/index.html"), "/invest/");
  assert.equal(pagePathOf("dist", "dist/404.html"), "/404.html");
});

test("inboundCounts：自链接不计，重复链接只算一次", () => {
  const entries = [
    { page: "/", html: '<a href="/a/">1</a><a href="/a/">2</a><a href="/">self</a>' },
    { page: "/a/", html: '<a href="/b/">go</a>' },
    { page: "/b/", html: "" },
  ];
  const { inbound, edges } = inboundCounts(entries);
  assert.equal(inbound.get("/a/"), 1, "同一页里链接两次只算一条入链");
  assert.equal(inbound.get("/b/"), 1);
  assert.equal(inbound.get("/"), 0, "自链接不算入链");
  assert.equal(edges, 2);
});

test("orphans：noindex / 跳转桩 / 错误页 / 后台页都不算孤儿", () => {
  const entries = [
    { page: "/", html: '<a href="/a/">x</a>' },
    { page: "/a/", html: '<a href="/">home</a>' },
    { page: "/b/", html: '<meta name="robots" content="noindex, nofollow">' },
    { page: "/c/", html: '<meta http-equiv="refresh" content="0;url=/">' },
    { page: "/404.html", html: "<h1>404</h1>" },
    { page: "/admin/utm/", html: "" },
  ];
  const found = orphans(inboundCounts(entries));
  assert.deepEqual(found, [], "都不该被判成孤儿");
});

test("orphans：真正的孤儿页要报出来", () => {
  const entries = [
    { page: "/", html: '<a href="/a/">x</a>' },
    { page: "/a/", html: '<a href="/">home</a>' },
    { page: "/forgotten/", html: "<h1>没人链接我</h1>" },
  ];
  assert.deepEqual(orphans(inboundCounts(entries)), ["/forgotten/"]);
});

test("isIndexable / isRedirectStub 判定口径", () => {
  assert.equal(isIndexable('<meta name="robots" content="noindex, nofollow">'), false);
  assert.equal(isIndexable("<title>x</title>"), true);
  assert.equal(isRedirectStub('<meta http-equiv="refresh" content="0;url=/photo/">'), true);
  assert.equal(isRedirectStub("<title>x</title>"), false);
});

test("本地门禁里有它；CI 里是 warn-only（不拦发布）", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["check:orphans"] ?? "", /check-orphans\.mjs/);
  assert.ok(pkg.scripts.gate.includes("npm run check:orphans"), "gate 要跑（该先修再推）");
  assert.ok(pkg.scripts.gate.indexOf("npm run build") < pkg.scripts.gate.indexOf("check:orphans"), "必须在 build 之后（要读 dist）");

  const workflow = await read(".github/workflows/deploy.yml");
  const start = workflow.indexOf("- name: Orphan pages (warn only)");
  assert.ok(start > 0, "deploy.yml 里要有这一步");
  const block = workflow.slice(start, start + 900);
  assert.match(block, /continue-on-error: true/, "不许拦发布");
  assert.match(block, /GITHUB_STEP_SUMMARY/);
  assert.match(block, /::warning title=零入链页面::/);
});
