/**
 * 反馈按钮的图标精灵（第 225 轮）。
 *
 * 一张日报页有 17 个反馈按钮，每个按钮的 `<svg>` 里都内联一份完整 path `d`：
 * 一对按钮约 900 字节，17 对就是 **21.8 KB / 页**，占页面 10.7%。而这些路径每页都一样 ——
 * 典型的"本该只出现一次的东西出现了 17 次"。
 *
 * 改法：path 提到隐藏 `<symbol>` 里，每页渲染一次；按钮侧只留 `<use href="#fb-icon-like">`。
 * 每页 -3.3 KB，同时还把 4 个越线的英文日报页拉回 220 KB 预算内。
 *
 * 这个改动最危险的失败方式不是报错，而是**静默**：模板里漏渲染精灵，图标就整片消失，
 * 构建、a11y、交互测试全绿（按钮还在，只是没有图形）。所以这里锁住"谁用按钮谁必须带精灵"。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

/** 所有渲染 MDX 正文的页面模板（反馈按钮是写在各篇 MDX 里的，模板侧看不到）。 */
const CONTENT_TEMPLATES = [
  "src/pages/ai/[slug].astro",
  "src/pages/en/ai/[slug].astro",
  "src/pages/invest/[slug].astro",
  "src/pages/en/invest/[slug].astro",
  "src/pages/hike/[slug].astro",
  "src/pages/en/hike/[slug].astro",
  "src/pages/photo/[slug].astro",
  "src/pages/en/photo/[slug].astro",
];

test("图标不再内联在按钮里，而是引用精灵", async () => {
  const buttons = await read("src/components/FeedbackButtons.astro");
  assert.match(buttons, /<use href="#fb-icon-like"/, "喜欢图标要走 <use>");
  assert.match(buttons, /<use href="#fb-icon-dislike"/, "不喜欢图标要走 <use>");
  assert.doesNotMatch(buttons, /d="M20\.84 4\.61/, "心形 path 不该再出现在按钮里（每页 17 份）");
  assert.doesNotMatch(buttons, /d="M10 15v4a3 3/, "踩的 path 也不该再出现");

  const sprite = await read("src/components/FeedbackIcons.astro");
  assert.match(sprite, /<symbol id="fb-icon-like"/, "精灵要定义喜欢图标");
  assert.match(sprite, /<symbol id="fb-icon-dislike"/, "精灵要定义不喜欢图标");
  assert.match(sprite, /aria-hidden="true"/, "精灵对读屏器不可见");
});

test("每个渲染正文的模板都必须带一次精灵（漏了就静默丢图标）", async () => {
  for (const rel of CONTENT_TEMPLATES) {
    const src = await read(rel);
    assert.match(src, /<Content \/>/, `${rel} 应该渲染正文`);
    assert.match(src, /import FeedbackIcons from "@\/components\/FeedbackIcons\.astro"/, `${rel} 少 import 精灵`);
    assert.match(src, /<FeedbackIcons \/>/, `${rel} 少渲染 <FeedbackIcons />`);
  }
});

test("精灵只能出现一次（每页一次就够，别跟着列表重复渲染）", async () => {
  for (const rel of CONTENT_TEMPLATES) {
    const src = await read(rel);
    const hits = src.match(/<FeedbackIcons \/>/g) ?? [];
    assert.equal(hits.length, 1, `${rel} 里精灵出现了 ${hits.length} 次`);
  }
});

test("内容页不再有任何 hydration 指令（第 226 轮：按钮改成 Astro 后 React 彻底离场）", async () => {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = new URL("../src/content/", import.meta.url).pathname;
  const offenders: string[] = [];
  const walk = async (cur: string): Promise<void> => {
    for (const entry of await readdir(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.name.endsWith(".mdx")) continue;
      const src = await readFile(full, "utf8");
      if (/client:(load|idle|visible|only)/.test(src)) offenders.push(full);
      if (/components\/FeedbackButtons"/.test(src)) offenders.push(`${full}（还在导入 tsx 版）`);
    }
  };
  await walk(dir);
  assert.deepEqual(offenders, [], `内容页里不该再有 hydration 指令：${offenders.slice(0, 3).join(", ")}`);
});
