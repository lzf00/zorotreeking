/**
 * 搜索结果的键盘导航（第 219 轮）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { enterTarget, nextIndex } from "../src/lib/search-keyboard";

test("↓ 从无高亮开始停在第一条，到底绕回开头", () => {
  assert.equal(nextIndex(-1, 1, 5), 0);
  assert.equal(nextIndex(0, 1, 5), 1);
  assert.equal(nextIndex(4, 1, 5), 0, "最后一条再按 ↓ 回到第一条");
});

test("↑ 从无高亮开始停在最后一条，到顶绕回末尾", () => {
  assert.equal(nextIndex(-1, -1, 5), 4);
  assert.equal(nextIndex(3, -1, 5), 2);
  assert.equal(nextIndex(0, -1, 5), 4, "第一条再按 ↑ 跳到末尾");
});

test("只有一条结果时上下键都停在它身上", () => {
  assert.equal(nextIndex(-1, 1, 1), 0);
  assert.equal(nextIndex(0, 1, 1), 0);
  assert.equal(nextIndex(0, -1, 1), 0);
});

test("没有结果时高亮是 -1（不渲染任何选中项）", () => {
  assert.equal(nextIndex(-1, 1, 0), -1);
  assert.equal(nextIndex(0, -1, 0), -1);
});

test("回车：有高亮开高亮项，没有就开第一条", () => {
  const results = [{ url: "/a/" }, { url: "/b/" }, { url: "/c/" }];
  assert.equal(enterTarget(results, 1), "/b/");
  assert.equal(enterTarget(results, -1), "/a/", "没按过 ↓ 时回车要能用");
  assert.equal(enterTarget(results, 99), "/a/", "越界要兜回第一条，不能返回 undefined");
  assert.equal(enterTarget([], 0), null, "没结果时返回 null，调用方别吞掉回车");
});

test("组件真的接上了：listbox/option/activedescendant 与按键处理（第 219 轮）", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/components/SearchModal.tsx", import.meta.url), "utf8");
  assert.match(src, /role="listbox"/, "结果列表要有 listbox 语义");
  assert.match(src, /role="option"/, "每条结果要有 option 语义");
  assert.match(src, /aria-selected=\{i === activeIndex\}/, "高亮要能被辅助技术读出来");
  assert.match(src, /aria-activedescendant=\{activeIndex >= 0/, "输入框要指向高亮项");
  // 输入框在列表外面，键盘事件只会冒泡到根节点：
  //   弹窗根节点 → handleKeyDown（内部先调 handleListKeys）
  //   页面根节点 → handleListKeys
  assert.match(src, /onKeyDown=\{handleKeyDown\}/, "弹窗根节点要接键盘处理");
  assert.match(src, /onKeyDown=\{handleListKeys\}/, "页面模式根节点要接键盘处理");
  const listboxBlocks = src.split('role="listbox"');
  for (const block of listboxBlocks.slice(1)) {
    const body = block.slice(0, block.indexOf("</div>"));
    assert.ok(!/role="status"/.test(body), "listbox 里只能放 option，状态文案要在外面");
  }
  assert.match(src, /event\.key === "ArrowDown"/);
  assert.match(src, /event\.key === "Enter"/);

  // 冒烟场景也要有，否则没人知道它在浏览器里到底还灵不灵
  const smoke = await readFile(new URL("../scripts/check-interactions.mjs", import.meta.url), "utf8");
  assert.match(smoke, /搜索：↓ 选结果、Enter 打开/);
});
