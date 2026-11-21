/**
 * 站外链接体检（第 132 轮）。
 *
 * `check:links` 只查站内；站外有 **5508 条**（74 个域名）从来没被验过。
 * 判定的难点不是"能不能连通"，而是别把反爬当成死链：x.com / 知乎 / 小红书 对任何
 * 非浏览器请求都回 403，把它们算死链，这个体检就会天天报警，最后没人看。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, hostOf, isBotBlockingHost, summarize } from "../scripts/lib/external-links.mjs";

test("2xx 正常，404/410 死链", () => {
  assert.equal(classify({ status: 200, url: "https://arxiv.org/abs/1" }), "ok");
  assert.equal(classify({ status: 301, url: "https://example.com/a" }), "ok");
  assert.equal(classify({ status: 404, url: "https://example.com/gone" }), "dead");
  assert.equal(classify({ status: 410, url: "https://example.com/gone" }), "dead");
});

test("反爬域名不算死链（403/429 都不算）", () => {
  assert.equal(classify({ status: 403, url: "https://x.com/someone/status/1" }), "blocked");
  assert.equal(classify({ status: 429, url: "https://www.zhihu.com/question/1" }), "blocked");
  // 反爬域名即使 404 也不报（有些站对爬虫一律回 404）
  assert.equal(classify({ status: 404, url: "https://www.douban.com/x" }), "blocked");
  assert.equal(isBotBlockingHost("https://twitter.com/a"), true);
  assert.equal(isBotBlockingHost("https://arxiv.org/abs/1"), false);
});

test("401/403/429 是反爬，其他 4xx 是可疑，5xx/超时是对方问题", () => {
  assert.equal(classify({ status: 403, url: "https://example.com/a" }), "blocked");
  assert.equal(classify({ status: 405, url: "https://example.com/a" }), "suspect");
  assert.equal(classify({ status: 451, url: "https://example.com/a" }), "suspect");
  assert.equal(classify({ status: 503, url: "https://example.com/a" }), "error");
  assert.equal(classify({ status: 0, error: "timeout", url: "https://example.com/a" }), "error");
});

test("域名归一化：www 前缀不影响判定", () => {
  assert.equal(hostOf("https://www.arxiv.org/abs/1"), "arxiv.org");
  assert.equal(hostOf("not a url"), "");
});

test("汇总：基线里的死链被跳过，死链按域名聚合", () => {
  const results = [
    { url: "https://a.com/1", verdict: "dead" },
    { url: "https://a.com/2", verdict: "dead" },
    { url: "https://b.com/3", verdict: "ok" },
    { url: "https://c.com/4", verdict: "dead" },
    { url: "https://d.com/5", verdict: "blocked" },
  ];
  const report = summarize(results, { baseline: { "https://c.com/4": { reason: "已知下线，正文已加存档链接" } } });
  assert.equal(report.counts.dead, 2);
  assert.equal(report.counts.skipped, 1, "基线里的链接不该再报");
  assert.deepEqual(report.byHost, [["a.com", 2]]);
  assert.equal(report.checked, 4);
});

test("没有死链时汇总不产生问题项", () => {
  const report = summarize([{ url: "https://a.com/1", verdict: "ok" }]);
  assert.equal(report.dead.length, 0);
  assert.equal(report.suspect.length, 0);
});

test("收集器只认 <a href>：preconnect 的 CDN 源站不算外链", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../scripts/check-external-links.mjs", import.meta.url), "utf8");
  // 第 132 轮实测踩到：`<link rel="preconnect" href="https://fonts.googleapis.com">` 根路径本来就 404，
  // 被当成死链报了两条假警报。
  assert.match(script, /<a\\s\[\^>\]\*href="/, "收集外链时必须限定 <a> 标签");
  assert.doesNotMatch(script, /matchAll\(\/href="\(https/, "不能用裸 href 正则（会收进 link/script 的地址）");
});
