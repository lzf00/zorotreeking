/**
 * a11y 抽查路径集（第 123 轮）。
 *
 * 之前 23 条路径里没有 `/now/`、`/guestbook/`、机翻英文页 —— 补上之后立刻抓到两个真 bug：
 *   /now/        页面内层又写了一个 `<main>`，和 BaseLayout 的 `<main id="main-content">` 嵌套，
 *                axe 报 "Document has more than one main landmark"
 *   /guestbook/  三个输入框用 `focus:outline-none` 抹掉焦点环，只留边框变色（键盘用户看不见焦点）
 *
 * 这里盯住"这些路径不许被移出抽查范围"，否则那两个 bug 会悄悄回来。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const SCRIPT = new URL("../scripts/check-a11y.mjs", import.meta.url);

async function script(): Promise<string> {
  return readFile(SCRIPT, "utf8");
}

test("曾经漏掉的三类页面必须在抽查集里", async () => {
  const src = await script();
  for (const path of ["/now/", "/guestbook/", "/en/invest/market-recap-2026-11-13/"]) {
    assert.ok(src.includes(`"${path}"`), `${path} 不在 a11y 抽查集里了`);
  }
});

test("页面不许再嵌套 main 地标", async () => {
  const now = await readFile(new URL("../src/pages/now.astro", import.meta.url), "utf8");
  const mains = now.match(/<main[\s>]/g) ?? [];
  assert.equal(mains.length, 0, "BaseLayout 已经提供 <main>，页面里不该再有");
});

test("留言板输入框不许只靠边框变色当焦点指示", async () => {
  const board = await readFile(new URL("../src/components/GuestbookBoard.tsx", import.meta.url), "utf8");
  const inputs = board.split("\n").filter((line) => line.includes("focus:outline-none"));
  assert.equal(inputs.length, 0, `还有 ${inputs.length} 个控件用 focus:outline-none 抹掉了焦点环`);
  assert.match(board, /focus-visible:outline/, "缺少键盘可见的焦点环");
});

test("检查器认 box-shadow 焦点环（Tailwind ring 也算可见）", async () => {
  const src = await script();
  assert.match(src, /boxShadow/, "只看 outline 会把 ring-* 误判成隐形焦点");
});
