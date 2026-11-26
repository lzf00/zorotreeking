/**
 * 语言切换链接的不变式（第 176 轮）。
 *
 * 切换按钮是唯一跨语言的导航入口：指错一个 translationKey，用户点一下就是 404。
 * 这里钉住三条不变式 + `<html lang>` 与路径一致，防止未来新增内容时悄悄破掉。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("三条不变式都在脚本里", async () => {
  const script = await read("scripts/check-lang-switch.mjs");
  assert.match(script, /切换链接指向不存在的页面/);
  assert.match(script, /是单向的（对端没有回链）/);
  assert.match(script, /没有切换链接，但对端 .* 存在（漏了切换）/);
});

test("对端路径的推导规则：/ ↔ /en/，其余加 /en 前缀", async () => {
  const script = await read("scripts/check-lang-switch.mjs");
  assert.match(script, /href === "\/" \? "\/en\/" : href\.startsWith\("\/en\/"\) \? href\.slice\(3\) : `\/en\$\{href\}`/);
});

test("<html lang> 必须与路径一致", async () => {
  const script = await read("scripts/check-lang-switch.mjs");
  assert.match(script, /const expectedLang = isEn \? "en" : "zh-CN"/);
  assert.match(script, /的 <html lang> 是/);
});

test("跳转桩不在检查范围内（/photography/ → /photo/）", async () => {
  const script = await read("scripts/check-lang-switch.mjs");
  assert.match(script, /Redirecting to /);
});

test("check:lang-switch 在门禁里，且速查页有它", async () => {
  const pkg = await read("package.json");
  assert.match(pkg, /"check:lang-switch": "node scripts\/check-lang-switch\.mjs"/);
  assert.match(pkg, /npm run check:i18n-leaks -- --non-blocking && npm run check:lang-switch &&/);
  assert.match(await read("docs/operations.md"), /check:lang-switch/);
});
