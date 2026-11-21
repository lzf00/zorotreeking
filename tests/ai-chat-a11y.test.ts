/**
 * AI 助手浮层的键盘/读屏契约（第 142 轮）。
 *
 * 实测修复前：懒加载换按钮后焦点掉到 <body>，面板打开后按 Tab 直接走到背后的页面链接；
 * Esc 关闭后焦点落到随机页面元素；对话记录没有 role=log（读屏不播报流式回复）；
 * 输入框只有 placeholder 没有标签。真正的判定在 scripts/check-a11y.mjs。
 *
 * 注意这层是**非模态**浮层：不设 aria-modal、不做焦点陷阱（要能一边聊一边读页面）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("打开时焦点进面板，关闭时回到悬浮按钮", async () => {
  const widget = await read("src/components/AIChatWidget.tsx");
  assert.match(widget, /inputRef\.current\?\.focus\(\)/, "打开后要把焦点放进输入框");
  assert.match(widget, /launcherRef\.current\?\.focus\(\)/, "关闭后要回到悬浮按钮");
  assert.match(widget, /ref=\{launcherRef\}/);
  assert.match(widget, /ref=\{inputRef\}/);
});

test("对话可播报：role=log + 回复状态 role=status", async () => {
  const widget = await read("src/components/AIChatWidget.tsx");
  assert.match(widget, /role="log"/);
  assert.match(widget, /aria-live="polite"/);
  assert.match(widget, /role="status"/);
  assert.match(widget, /aria-label="输入消息"/);
});

test("这层是非模态：不能加 aria-modal，也不要焦点陷阱", async () => {
  const widget = await read("src/components/AIChatWidget.tsx");
  assert.doesNotMatch(widget, /aria-modal/, "非模态浮层设 aria-modal 会误导辅助技术");
  assert.doesNotMatch(widget, /handleKeyDown/, "做出焦点陷阱会挡住读页面");
});

test("门禁里真的会验它", async () => {
  const check = await read("scripts/check-a11y.mjs");
  assert.match(check, /chat-panel-keyboard/);
  assert.match(check, /打开后焦点没有进入面板/);
  assert.match(check, /关闭后焦点没有回到悬浮按钮/);
});
