/**
 * 200% 文字缩放守卫（第 173 轮，WCAG 1.4.4）。
 *
 * 之前的响应式测试只改视口宽度，没改根字号 —— 而手机「大字体」放大的是后者，
 * 媒体查询断点不跟着变。这轮把「根字号 32px 下横向溢出」变成可回归的预算。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("测的是根字号，不是视口宽度", async () => {
  const script = await read("scripts/check-text-zoom.mjs");
  assert.match(script, /document\.documentElement\.style\.fontSize = `\$\{rootFontPx\}px`/);
  assert.match(script, /const ROOT_FONT_PX = Number\(valueOf\("font", "32"\)\)/);
  assert.match(script, /scrollWidth - doc\.clientWidth/);
});

test("预算只许降不许升（有 BASELINE 表）", async () => {
  const script = await read("scripts/check-text-zoom.mjs");
  assert.match(script, /const BASELINE = new Map\(/);
  assert.match(script, /if \(overflow > budget\)/);
  assert.match(script, /已有债务/);
});

test("已清零的模板预算必须是 0（防止有人把预算悄悄调高）", async () => {
  const script = await read("scripts/check-text-zoom.mjs");
  for (const path of ["/", "/ai/", "/photo/", "/photo/baokemeng/", "/hike/", "/guestbook/", "/en/ai/digest-2026-11-22/"]) {
    const line = script.split("\n").find((l) => l.includes(`["${path}",`));
    assert.ok(line, `BASELINE 里应有 ${path}`);
    assert.match(line, /, 0\],/, `${path} 的预算应为 0`);
  }
});

test("200% 文字下导航栏不能再溢出（第 173 轮的实际修复）", async () => {
  const navbar = await read("src/components/Navbar.astro");
  assert.match(navbar, /min-h-14 py-2 flex flex-wrap items-center justify-between/);
  assert.match(navbar, /flex flex-wrap items-center justify-end gap-2/);
});

test("check:text-zoom 在门禁里，且速查页有它", async () => {
  const pkg = await read("package.json");
  assert.match(pkg, /"check:text-zoom": "node scripts\/check-text-zoom\.mjs"/);
  assert.match(pkg, /npm run check:focus && npm run check:text-zoom &&/);
  assert.match(await read("docs/operations.md"), /check:text-zoom/);
});
