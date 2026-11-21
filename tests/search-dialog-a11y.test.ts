/**
 * 搜索对话框的键盘/读屏契约（第 140 轮）。
 *
 * 实测修复前的行为：`aria-modal` 缺失、按两次 Tab 焦点就跑到背后的页面链接、
 * Esc 关闭后焦点掉到 <body>、输入框只有 placeholder 没有可读标签、结果变化没有播报。
 * 真正的判定在 `scripts/check-a11y.mjs`（浏览器里真按键），这里锁住代码没被改回去。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("对话框标记：aria-modal + 可读标签 + 输入框标签 + 结果播报", async () => {
  const modal = await read("src/components/SearchModal.tsx");
  assert.match(modal, /aria-modal="true"/, "缺 aria-modal，辅助技术不会把背景当不可交互");
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-label="站内搜索"/);
  assert.match(modal, /aria-label="输入搜索关键词"/, "只有 placeholder 不算标签");
  assert.match(modal, /role="status"/);
  assert.match(modal, /aria-live="polite"/);
});

test("焦点陷阱与焦点归还：代码里必须有这两段逻辑", async () => {
  const modal = await read("src/components/SearchModal.tsx");
  assert.match(modal, /function handleKeyDown/, "缺 Tab 键处理（焦点陷阱）");
  assert.match(modal, /onKeyDown=\{handleKeyDown\}/, "Tab 处理没挂到对话框上");
  assert.match(modal, /restoreFocusRef/, "关闭时应把焦点还给打开它的按钮");
  assert.match(modal, /document\.contains\(target\)/, "要判断原元素是否还在文档里再聚焦");
});

test("门禁里必须有真实的浏览器断言（否则只是纸面契约）", async () => {
  const check = await read("scripts/check-a11y.mjs");
  assert.match(check, /search-dialog-keyboard/, "缺检查项 id");
  assert.match(check, /焦点跑出对话框/);
  assert.match(check, /关闭后焦点没有回到触发按钮/);
  assert.match(check, /path === "\/"/, "只在首页验一次即可，别把每页都拖慢");
});
