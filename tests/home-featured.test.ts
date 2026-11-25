/**
 * 首页首屏第一张精选卡必须是「人写的内容」（第 206 轮）。
 *
 * 线上实测的 bug：首屏第一张卡是 2026-11-18 的股票日报，而当天已有 11-25 的内容。
 * 注释写着"自动生成的日报/复盘不参与"，代码只排掉了 digest；market-recap 的 tag 是
 * `market-recap/wind/daily`，靠涨跌停表格天然最长，把首屏占了一周。
 *
 * 修法在 home-selection.ts（isAutoReport），这里守的是**构建产物**：单测证明不了线上那个
 * HTML 里第一张卡是谁，只有读 dist 才知道。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { AUTO_HREF_PREFIXES, FEATURED_CARDS, featuredLinks, judgeFeatured } from "../scripts/check-home-featured.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

const card = (href: string) => `<a href="${href}" class="group relative rounded-2xl p-6">x</a>`;
const page = (cards: string[], extra = "") =>
  `<main><h2 class="x">精选阅读</h2><div class="grid">${cards.join("")}</div>${extra}<h2>最近更新</h2><a href="/archive/">归档</a></main>`;

test("抽出精选卡链接，不把区块外的链接算进来", () => {
  const html = page([card("/note/"), card("/ai/digest-2026-11-25/"), card("/photo/x/")], "");
  assert.deepEqual(featuredLinks(html), ["/note/", "/ai/digest-2026-11-25/", "/photo/x/"]);
});

test("「最近更新」里的链接不会被当成精选卡", () => {
  const html = page([card("/note/"), card("/a/"), card("/b/")]);
  assert.equal(featuredLinks(html)?.length, FEATURED_CARDS);
});

test("找不到精选区 → 不返回空数组（那会被当成通过）", () => {
  assert.equal(featuredLinks("<main>没有这个区块</main>"), null);
  assert.deepEqual(judgeFeatured(null), ["首页里找不到「精选阅读」区块 —— 要么模板改了，要么构建产物不对"]);
});

test("第一张是自动生成的日报/复盘 → 报错", () => {
  for (const prefix of AUTO_HREF_PREFIXES) {
    const problems = judgeFeatured([`${prefix}2026-11-18/`, "/ai/digest-2026-11-25/", "/photo/x/"]);
    assert.equal(problems.length, 1, `${prefix} 应该被抓到`);
    assert.match(problems[0], /自动生成/);
  }
});

test("够 3 张卡、第一张是人写的 → 通过；不足 3 张 → 报错", () => {
  assert.deepEqual(judgeFeatured(["/ai/weekly-2026-W46/", "/ai/digest-2026-11-25/", "/photo/baokemeng/"]), []);
  assert.equal(judgeFeatured(["/ai/weekly-2026-W46/"]).length, 1);
});

test("第二、三张是自动内容没问题（精选第 2 张本来就该是最新日报）", () => {
  assert.deepEqual(judgeFeatured(["/note/", "/ai/digest-2026-11-25/", "/invest/digest-2026-11-25/"]), []);
});

test("本地门禁里有它，且在 build 之后", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["check:home-featured"] ?? "", /check-home-featured\.mjs/);
  const gate = pkg.scripts.gate;
  assert.ok(gate.includes("npm run check:home-featured"));
  assert.ok(gate.indexOf("npm run build") < gate.indexOf("check:home-featured"), "要读构建产物");
});
