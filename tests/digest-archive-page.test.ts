/**
 * 四个日报归档页共用一套渲染（第 133 轮）。
 *
 * 起因：`/invest/digest/` 把 **189 期**日报全部渲染成大卡片（封面 + 摘要 + 标签），
 * HTML **429 KB**，是全站最重的一页；四个归档页各抄一份实现，改一处要改四处。
 * 现在共用 `DigestArchiveGrid`：最新 6 期大卡片，更早的按月走紧凑行，**链接一条不少**。
 * 实测 429/392/386/377 KB → 218/226/221/215 KB。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const PAGES = [
  ["src/pages/invest/digest/[...page].astro", "invest"],
  ["src/pages/en/invest/digest/[...page].astro", "invest"],
  ["src/pages/ai/digest/[...page].astro", "ai"],
  ["src/pages/en/ai/digest/[...page].astro", "ai"],
] as const;

test("四个归档页都用同一个组件，不再各写一份按月分组", async () => {
  for (const [path, accent] of PAGES) {
    const source = await read(path);
    assert.match(source, /import DigestArchiveGrid from "@\/components\/DigestArchiveGrid\.astro"/, `${path} 没用共享组件`);
    assert.match(source, new RegExp(`accent="${accent}"`), `${path} 的 accent 不对`);
    assert.doesNotMatch(source, /groups\[ym\]\.map/, `${path} 还留着旧的按月渲染`);
    assert.doesNotMatch(source, /const months = Object\.keys\(groups\)/, `${path} 还留着 months 分组`);
  }
});

test("组件默认只给最新 6 期大卡片，更早的走紧凑行", async () => {
  const component = await read("src/components/DigestArchiveGrid.astro");
  assert.match(component, /featuredCount = 6/);
  assert.match(component, /cards\.slice\(0, featuredCount\)/);
  assert.match(component, /olderGroups\[ym\]\.map/, "更早的期数必须仍然渲染成链接");
  assert.match(component, /labels\.older\(olderCount\)/);
  // 紧凑行里日期只用 MM-DD，标题截断——避免又把整页撑回 400 KB
  assert.match(component, /card\.iso\.slice\(5\)/);
  assert.match(component, /truncate group-hover:underline/);
});

test("紧凑行的日期用够对比度的颜色（第 133 轮实测 4.09:1 失败）", async () => {
  const component = await read("src/components/DigestArchiveGrid.astro");
  // 深色底 #0a0a0a 上 zinc-500 (#71717a) 只有 4.09:1，必须用 zinc-400 以上
  assert.doesNotMatch(component, /dark:text-zinc-500/, "深色模式下 zinc-500 对比度不足 4.5:1");
  assert.match(component, /dark:text-zinc-400/);
});

test("每期链接的 href 由页面传入，组件不自己拼路径", async () => {
  const component = await read("src/components/DigestArchiveGrid.astro");
  assert.match(component, /href=\{card\.href\}/);
  assert.doesNotMatch(component, /digest-\$\{|translationKey/, "路径拼接留在页面里，组件不该知道板块");
});
