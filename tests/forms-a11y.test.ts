/**
 * 表单与导航的可访问性契约（第 143 轮）。
 *
 * 这轮的两类问题都属于「axe 不报、但读屏/键盘用户会撞上」：
 *  1. 订阅邮箱框只有 placeholder 没有名字（实测 axe 的 label 规则在 /subscribe/ 上不报）；
 *  2. 移动端菜单按 Esc 不关、点空白处不关（`<details>` 原生只支持再点一次 summary）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("订阅表单：邮箱框有可读名称，占位符本地化", async () => {
  const zh = await read("src/pages/subscribe.astro");
  assert.match(zh, /aria-label="邮箱地址"/);
  assert.match(zh, /placeholder="你的邮箱"/);
  const en = await read("src/pages/en/subscribe.astro");
  assert.match(en, /aria-label="Email address"/);
  assert.doesNotMatch(en, /title="buttondown response sink"/, "iframe 标题不该是开发者占位串");
});

test("全站订阅 CTA：中英各自的标签与 iframe 标题", async () => {
  const cta = await read("src/components/SubscribeCTA.astro");
  assert.match(cta, /aria-label=\{t\("邮箱地址", "Email address"\)\}/);
  assert.match(cta, /t\("订阅结果", "Subscription response"\)/);
});

test("提交结果要能被播报（role=status）", async () => {
  const zh = await read("src/pages/subscribe.astro");
  const cta = await read("src/components/SubscribeCTA.astro");
  assert.match(zh, /id="buttondown-ok" role="status" aria-live="polite"/);
  assert.match(cta, /id=\{okId\} role="status" aria-live="polite"/);
});

test("门禁会断言「表单控件必须有名字」，且 placeholder 不算", async () => {
  const check = await read("scripts/check-a11y.mjs");
  assert.match(check, /form-field-no-name/);
  assert.match(check, /placeholder 不算/);
  // 名字来源必须是 aria-label / aria-labelledby / label / title，不能把 placeholder 写进去
  // 只看 nameOf 函数体：placeholder 不能被当作名字来源
  const body = check.slice(check.indexOf("const nameOf"), check.indexOf("const visible"));
  assert.doesNotMatch(body, /placeholder/);
});

test("移动端菜单：Esc 关闭并把焦点还给按钮，点空白也关", async () => {
  const nav = await read("src/components/Navbar.astro");
  assert.match(nav, /closeMobileNav/, "缺关闭函数");
  assert.match(nav, /event\.key === "Escape"[\s\S]{0,60}closeMobileNav\(true\)/, "Esc 要关闭并归还焦点");
  assert.match(nav, /pointerdown/, "点空白处也要关");
  assert.match(nav, /切换深浅色主题/, "主题按钮的标签要本地化，不能留英文 toggle theme");
});
