import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RSS = new URL("../src/pages/rss.xml.ts", import.meta.url);

test("RSS 必须声明 atom:link rel=self（聚合器靠它认规范地址）", async () => {
  const src = await readFile(RSS, "utf8");
  assert.match(src, /<atom:link[^>]*rel="self"/);
  assert.match(src, /xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/);
  assert.match(src, /type="application\/rss\+xml"/);
});

test("RSS 必须带 lastBuildDate 与 ttl", async () => {
  const src = await readFile(RSS, "utf8");
  assert.match(src, /<lastBuildDate>\$\{latest\.toUTCString\(\)\}<\/lastBuildDate>/);
  assert.match(src, /<ttl>60<\/ttl>/);
});

test("RSS 条数要封顶（feed 是整份重传，历史条目阅读器本地已有）", async () => {
  const src = await readFile(RSS, "utf8");
  assert.match(src, /all\.slice\(0, MF_MAX_ITEMS\)/, "items 必须被 slice 截断");
  const cap = Number(src.match(/const MF_MAX_ITEMS = (\d+);/)?.[1] ?? Number.NaN);
  assert.ok(Number.isFinite(cap) && cap > 0 && cap <= 100, `封顶值应在 1..100，实际 ${cap}`);
});
