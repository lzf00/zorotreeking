/**
 * 标签页签发的「最新 N 篇详细 + 更早紧凑行」（第 134 轮）。
 *
 * `#auto` 一个标签下挂了 300+ 篇：全带摘要时实测 **3407 个标签 / 321 KB**，
 * 而 gzip 只有 31 KB —— 字节不是主要成本，重复的长 class 才是。
 * 现在最新 20 篇保留板块/日期/摘要，更早的只留「日期 + 板块 + 标题」，
 * 链接一条不少；实测降到 2267 个标签 / 301 KB，gzip 不变。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// 第 191 轮起标签页变成分页路由：`[tag]/[...page].astro`
const PAGES = ["src/pages/tag/[tag]/[...page].astro", "src/pages/en/tag/[tag]/[...page].astro"] as const;

test("中英标签页都只给前 20 篇摘要，其余走紧凑行", async () => {
  for (const path of PAGES) {
    const source = await read(path);
    assert.match(source, /const DETAILED_COUNT = 20/, `${path} 缺少 DETAILED_COUNT`);
    // 第 191 轮：摘要段只在第 1 页出现，第 2 页起全走紧凑行
    assert.match(source, /posts\.slice\(0, pageNumber === 1 \? DETAILED_COUNT : 0\)\.map/, `${path} 详情段没切片`);
    assert.match(source, /posts\.slice\(pageNumber === 1 \? DETAILED_COUNT : 0\)\.map/, `${path} 紧凑段没切片`);
    // 两条路径都必须渲染链接，否则内容就从列表里消失了
    const hrefs = source.match(/href=\{pathWithLang\(`\/\$\{p\.section\}/g) ?? [];
    assert.equal(hrefs.length, 2, `${path} 应有两处（详情 + 紧凑）链接渲染，实际 ${hrefs.length} 处`);
  }
});

test("紧凑行带 datetime，深色模式对比度够（不用 zinc-500）", async () => {
  for (const path of PAGES) {
    const source = await read(path);
    const compact = source.slice(source.indexOf("posts.slice(pageNumber === 1 ? DETAILED_COUNT : 0)"));
    // 第 196 轮：日期一律走 siteDateString（UTC 切片会把 +08 的日期退回前一天）
    assert.match(compact, /datetime=\{siteDateString\(p\.date\)\}/, "日期要机器可读，且用站点时区");
    assert.doesNotMatch(compact.slice(0, 1200), /dark:text-zinc-500/, "深色底 zinc-500 只有 4.09:1");
  }
});
