/**
 * 站内搜索的**相关性**闸门（第 198 轮）。
 *
 * 起因不是"搜不到"，而是"搜得到但不是你想看的"：
 *   - 第 194 轮：分页页（/archive/2..5/）整族进索引，搜「归档」先出一堆分页页；
 *   - 第 198 轮：标签页 / 归档页 / /now/ 把**别处页面的标题**成百上千次地抄进自己的正文，
 *     于是搜「日报」先出一串标签页，真正的日报归档页进不了前 5。
 *
 * 两次都属于"结果不为空、只是排错了"。原来的探针只断言有没有结果、索引新不新、命中是不是
 * 死链 —— 这类问题一条都测不出来。这里补两条：
 *   1) `evaluateRelevance` 的纯逻辑单测（期望表命中 / 落空 / 查询没跑成）；
 *   2) 结构性断言：回声列表必须带 `data-pagefind-ignore`，否则索引又被别的页面填满。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { DEFAULT_QUERIES, RELEVANCE_EXPECTATIONS, evaluateRelevance } from "../scripts/check-search.mjs";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("期望表覆盖站内入口页，且名次区间合理", () => {
  assert.ok(RELEVANCE_EXPECTATIONS.length >= 8, "期望表至少覆盖 8 个入口页");
  for (const item of RELEVANCE_EXPECTATIONS) {
    assert.ok(item.rank >= 1 && item.rank <= 5, `${item.query} 的期望名次应在 1–5`);
    assert.ok(item.url.startsWith("/") && item.url.endsWith("/"), `${item.url} 应是站内绝对路径`);
  }
  // 第 194 / 198 两轮修过的词必须留在表里，防止以后又被"优化"掉
  const queries = RELEVANCE_EXPECTATIONS.map((item) => item.query);
  for (const must of ["日报", "归档"]) assert.ok(queries.includes(must), `${must} 必须被相关性探针覆盖`);
});

test("期望表里的每个词都在默认查询集里（否则 CLI 根本不搜它）", () => {
  const missing = RELEVANCE_EXPECTATIONS.map((item) => item.query).filter((query) => !DEFAULT_QUERIES.includes(query));
  assert.deepEqual(missing, [], `这些词不在 DEFAULT_QUERIES 里，相关性断言等于没跑：\n${missing.join("\n")}`);
});

test("目标页在可接受名次内 → 通过", () => {
  const rows = [{ query: "日报", top: ["/invest/digest/", "/archive/"], total: 2 }];
  const [result] = evaluateRelevance(rows, [{ query: "日报", url: "/invest/digest/", rank: 2 }]);
  assert.equal(result.ok, true);
  assert.equal(result.actual, 1);
});

test("目标页排在可接受名次之外 → 失败并说明第几名", () => {
  const rows = [{ query: "日报", top: ["/tag/a/", "/tag/b/", "/invest/digest/"], total: 3 }];
  const [result] = evaluateRelevance(rows, [{ query: "日报", url: "/invest/digest/", rank: 2 }]);
  assert.equal(result.ok, false);
  assert.equal(result.actual, 3);
  assert.match(result.reason ?? "", /排第 3 名/);
});

test("目标页根本没出现 → 失败", () => {
  const rows = [{ query: "归档", top: ["/x/", "/y/"], total: 2 }];
  const [result] = evaluateRelevance(rows, [{ query: "归档", url: "/archive/", rank: 3 }]);
  assert.equal(result.ok, false);
  assert.equal(result.actual, null);
  assert.match(result.reason ?? "", /没有 \/archive\//);
});

test("查询本身报错 → 明确失败原因，而不是静默跳过", () => {
  const rows = [{ query: "标签", error: "403 fetching fragment" }];
  const [result] = evaluateRelevance(rows, [{ query: "标签", url: "/tag/", rank: 1 }]);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /没跑成/);
});

test("回声列表必须带 data-pagefind-ignore（标签页 / 归档 / now）", async () => {
  const targets: [string, RegExp][] = [
    ["src/pages/tag/[tag]/[...page].astro", /<ul data-pagefind-ignore/],
    ["src/pages/en/tag/[tag]/[...page].astro", /<ul data-pagefind-ignore/],
    ["src/components/ArchiveByYear.astro", /<div data-pagefind-ignore/],
    ["src/pages/now.astro", /<ul data-pagefind-ignore/],
  ];
  for (const [path, pattern] of targets) {
    const source = await read(path);
    assert.match(source, pattern, `${path}: 回声列表没加 data-pagefind-ignore，索引会被别处标题填满`);
  }
});
