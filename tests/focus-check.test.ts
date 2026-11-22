/**
 * 键盘焦点可见性守卫（第 172 轮，WCAG 2.4.7）。
 *
 * axe 只看静态 DOM，测不到"按下 Tab 之后有没有视觉反馈"。这里的测试钉住三件事：
 *   1. 脚本必须用真 Tab 按键测（`el.focus()` 不会命中 `:focus-visible` —— 本轮第一版
 *      探测就是这么误报的）；
 *   2. 明暗两个主题都要测（浅色环在近黑底上可能看不见）；
 *   3. 必须有反空转：Tab 真的在移动焦点。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("用真 Tab 按键测，不能用 el.focus() 冒充", async () => {
  const script = await read("scripts/check-focus.mjs");
  assert.match(script, /page\.keyboard\.press\("Tab"\)/);
  assert.match(script, /el\.focus\(\)`? 不会让 `?:focus-visible`? 命中/);
});

test("明暗两主题都测", async () => {
  const script = await read("scripts/check-focus.mjs");
  assert.match(script, /for \(const theme of \["light", "dark"\]\)/);
});

test("反空转：Tab 没推进焦点就判失败", async () => {
  const script = await read("scripts/check-focus.mjs");
  assert.match(script, /seen\.size < 5/);
  assert.match(script, /检查不可信/);
});

test("焦点判据是环或阴影，且要检查宽度不为 0", async () => {
  const script = await read("scripts/check-focus.mjs");
  assert.match(script, /outlineStyle !== "none" && Number\.parseFloat\(cs\.outlineWidth\) > 0/);
  assert.match(script, /boxShadow !== "none"/);
});

test("check:focus 在门禁里，且速查页有它", async () => {
  const pkg = await read("package.json");
  assert.match(pkg, /"check:focus": "node scripts\/check-focus\.mjs"/);
  assert.match(pkg, /npm run check:interactions && npm run check:focus && npm run check:runtime/);
  const docs = await read("docs/operations.md");
  assert.match(docs, /check:focus/);
});
