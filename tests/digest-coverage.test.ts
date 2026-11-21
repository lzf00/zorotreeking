/**
 * 日报摘要覆盖度（第 120 轮）。
 *
 * 线上 20 期中文日报整条没有摘要正文（另有 18 期部分条目），但 frontmatter 描述和
 * RSS/Atom 的 <summary> 还在说「多源聚合 + AI 摘要」。读者从阅读器点进来只有一串标题。
 * 这里把"有没有正文"变成可断言的事实，页面与 feed 都用同一份口径说话。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { coverageNotice, digestCoverage } from "../src/lib/digest-coverage";

const ITEM = (title: string, prose?: string) =>
  `## <a href="https://example.com/x">${title}</a>\n\n*HF ★ 3 · 作者*\n\n${prose ? `${prose}\n\n` : ""}<FeedbackButtons slug="item:x" client:visible />\n`;

test("全部条目有正文：不需要任何提示", () => {
  const c = digestCoverage(ITEM("A", "这是摘要。") + ITEM("B", "另一段摘要。"));
  assert.deepEqual(c, { items: 2, withSummary: 2, allMissing: false, someMissing: false });
  assert.equal(coverageNotice(c, "zh"), null);
});

test("全部条目没正文：说清 0 条摘要，并解释下面只有标题与链接", () => {
  const c = digestCoverage(ITEM("A") + ITEM("B"));
  assert.equal(c.allMissing, true);
  const note = coverageNotice(c, "zh");
  assert.match(note!, /本期 2 条都没有生成摘要/);
  assert.match(note!, /标题、来源与原文链接/);
});

test("部分缺：说清楚缺几条，不夸大", () => {
  const c = digestCoverage(ITEM("A", "有摘要") + ITEM("B") + ITEM("C", "也有"));
  assert.equal(c.withSummary, 2);
  assert.equal(c.someMissing, true);
  assert.match(coverageNotice(c, "zh")!, /3 条里有 1 条没有摘要/);
});

test("英文版提示（/en/ 读者也看得懂）", () => {
  const c = digestCoverage(ITEM("A"));
  assert.match(coverageNotice(c, "en")!, /No summaries were generated/);
});

test("meta 斜体、组件、图片都不算摘要正文", () => {
  const body = `## <a href="/x">标题</a>\n\n*HF ★ 3*\n\n<FeedbackButtons slug="item:x" client:visible />\n\n![图](a.jpg)\n`;
  assert.equal(digestCoverage(body).withSummary, 0);
});

test("空正文/纯 frontmatter 不崩", () => {
  assert.deepEqual(digestCoverage(""), { items: 0, withSummary: 0, allMissing: false, someMissing: false });
  assert.deepEqual(digestCoverage(null), { items: 0, withSummary: 0, allMissing: false, someMissing: false });
});

test("真实日报：有摘要的那期不出现提示，全无摘要的那期必须出现", async () => {
  const read = async (slug: string) => {
    const raw = await readFile(new URL(`../src/content/ai/${slug}`, import.meta.url), "utf8");
    return raw.split("---").slice(2).join("---");
  };
  const good = digestCoverage(await read("digest-2026-11-21.zh.mdx"));
  assert.equal(good.someMissing || good.allMissing, false, "最新的日报应该是完整的");
  const empty = digestCoverage(await read("digest-2026-10-12.zh.mdx"));
  assert.equal(empty.allMissing, true, "这一期整条没有摘要，是已知的历史欠账");
});

test("feed 不再复述「AI 摘要」：日报 summary 用真实条目标题拼", async () => {
  const atom = await readFile(new URL("../src/pages/atom.xml.ts", import.meta.url), "utf8");
  const rssPage = await readFile(new URL("../src/pages/rss.xml.ts", import.meta.url), "utf8");
  for (const [name, src] of [["atom", atom], ["rss", rssPage]] as const) {
    assert.match(src, /digestDescription/, `${name} 没有改用真实条目描述`);
  }
});
