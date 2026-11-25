/**
 * `/search/` 真页面（第 187 轮）。
 *
 * 事故：站内搜索只有浮层，`/search/` 直接 404（`docs/known-debt.md` 里挂着的一条），
 * 而且搜到的词没法分享 —— 结果全在 React state 里，刷新就没了。
 *
 * 这个测试守四件事：
 *   1. 页面存在且是 noindex（结果页对搜索引擎是薄内容）；
 *   2. 它不在 sitemap 的静态清单里（noindex 的页面出现在 sitemap 里会被 check:seo 判红，
 *      而那条规则正是第 112 轮加的）；
 *   3. 搜索岛支持页面模式和 `?q=` 深链；
 *   4. 深链里的关键词是唯一事实来源（输入时写回地址栏，可分享）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("/search/ 是真页面，且 noindex", async () => {
  const page = await read("src/pages/search.astro");
  assert.match(page, /<BaseLayout[^>]*noindex/, "结果页必须 noindex");
  assert.match(page, /SearchModal[\s\S]{0,120}variant="page"/, "用搜索岛的页面模式渲染");
  assert.match(page, /<noscript>/, "没有 JS 时也要给出路（归档/日报索引）");
});

test("/search/ 不在 sitemap 的静态清单里", async () => {
  const sitemap = await read("src/lib/sitemap.ts");
  assert.doesNotMatch(sitemap, /"\/search"/, "noindex 页面不能出现在 sitemap 里");
});

test("搜索岛支持页面模式和 ?q= 深链", async () => {
  const modal = await read("src/components/SearchModal.tsx");
  assert.match(modal, /variant\?: "modal" \| "page"/);
  assert.match(modal, /params\.get\("q"\)/, "进来要读 ?q=");
  assert.match(modal, /history\.replaceState/, "输入要写回地址栏（可分享、可后退）");
  assert.match(modal, /role="search"/, "页面模式用 landmark 而不是 modal 语义");
  assert.match(modal, /在搜索页查看全部结果/, "浮层要能跳到真页面看全部结果");
  // 空结果时容器里只剩输入框，焦点陷阱会把 Tab 绕回自己 —— 必须是 length < 2 就放行
  assert.match(modal, /focusable\.length < 2\) return/, "单元素时不能做焦点陷阱");
  assert.doesNotMatch(
    modal.slice(modal.indexOf('role="search"'), modal.indexOf('role="search"') + 600),
    /aria-modal/,
    "页面模式不是模态对话框，不该声明 aria-modal",
  );
});

test("/en/search/ 存在、是英文界面、同样 noindex", async () => {
  const page = await read("src/pages/en/search.astro");
  assert.match(page, /<BaseLayout[\s\S]{0,160}noindex/);
  assert.match(page, /lang="en"/, "英文页要把 lang 传给搜索岛");

  const modal = await read("src/components/SearchModal.tsx");
  assert.match(modal, /const COPY = \{/, "文案要按语言拆表");
  assert.match(modal, /en: \{[\s\S]{0,400}Search posts, digests, notes/, "英文文案要有");
  // 只截到 en 对象结束（后面的类型定义里有中文注释，不算文案）
  const start = modal.indexOf("  en: {");
  const end = modal.indexOf("} as const;", start);
  const enBlock = modal.slice(start, end);
  assert.doesNotMatch(enBlock, /[\u4e00-\u9fff]/, "英文文案里不许混中文");
});

test("浮层的语言跟页面走（英文页面不该弹中文浮层）", async () => {
  const entry = await read("src/entrypoints/search.tsx");
  assert.match(entry, /document\.documentElement\.lang === "en"/, "按 <html lang> 判断");
  assert.match(entry, /lang=\{lang\}/, "把语言传给 SearchModal");
});

test("中英两版搜索页互链（check:lang-switch 要求成对）", async () => {
  const zh = await read("src/pages/search.astro");
  const en = await read("src/pages/en/search.astro");
  assert.match(zh, /href="\/en\/search\/"[^>]*>English</, "中文页要有 English 切换");
  assert.match(en, /href="\/search\/"[^>]*>中文</, "英文页要有 中文 切换");
});
