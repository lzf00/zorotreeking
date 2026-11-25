/**
 * 分页页的 <title> / description 必须带页码（第 195 轮）。
 *
 * 这是第 189–192 轮分页留下的尾巴：五页一族的列表页整族共用同一个标题，
 * `/archive/` 与 `/archive/4/` 的 `<title>` 一字不差。两个后果都不小：
 *   - 搜索引擎看到 5 个页面标题完全相同（重复内容信号），
 *   - 浏览器标签页/书签里分不出是哪一页。
 *
 * `check:seo` 现在把「标题重复」判成硬错误（第 195 轮新增），这里再加一层源码级断言：
 * 免得新加一族分页页时又忘了带页码 —— 那种情况 dist 检查能抓到，但要等构建完。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const PAGINATED = [
  "src/pages/ai/digest/[...page].astro",
  "src/pages/en/ai/digest/[...page].astro",
  "src/pages/invest/digest/[...page].astro",
  "src/pages/en/invest/digest/[...page].astro",
  "src/pages/archive/[...page].astro",
  "src/pages/en/archive/[...page].astro",
  "src/pages/tag/[tag]/[...page].astro",
  "src/pages/en/tag/[tag]/[...page].astro",
  "src/pages/changelog/[...page].astro",
];

test("九类分页页的标题都按 pageNumber 分支", async () => {
  const missing: string[] = [];
  for (const path of PAGINATED) {
    const src = await read(path);
    if (!/title=\{pageNumber > 1 \?/.test(src)) missing.push(path);
  }
  assert.deepEqual(missing, [], `这些分页页的 title 没带页码：\n${missing.join("\n")}`);
});

test("描述也带页码（否则描述去重报告里永远是整族同名）", async () => {
  const missing: string[] = [];
  for (const path of PAGINATED) {
    const src = await read(path);
    // 描述里可能先有 `${digests.length}` 这类插值，所以按「同一行里出现 description= 与 pageNumber > 1」判
    const line = src.split("\n").find((l) => l.includes("description=") && l.includes("pageNumber > 1"));
    if (!line) missing.push(path);
  }
  assert.deepEqual(missing, [], `这些分页页的 description 没带页码：\n${missing.join("\n")}`);
});

test("英文页的页码文案不许出现中文", async () => {
  const EN = PAGINATED.filter((p) => p.startsWith("src/pages/en/"));
  for (const path of EN) {
    const src = await read(path);
    const line = src.split("\n").find((l) => /title=\{pageNumber > 1/.test(l)) ?? "";
    assert.doesNotMatch(line, /[\u4e00-\u9fa5]/, `${path}: 英文页标题里混进了中文 → ${line.trim()}`);
  }
});
