/**
 * 留言板表单的可访问性（第 145 轮）。
 *
 * 全站 a11y 巡检（64 次检查）抓到 /guestbook/ 有 3 个控件"没有名字"：
 * 昵称、邮箱、留言内容都写了可见 label，但**没有 htmlFor/id 关联** ——
 * 视觉上对，程序上断。读屏用户听到的是"输入框"。
 *
 * 门禁的表单名检查（第 143 轮加的）正是为这类问题准备的，这轮反过来被它抓到自己。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("三个控件都通过 htmlFor/id 连上 label", async () => {
  const board = await read("src/components/GuestbookBoard.tsx");
  for (const [label, id] of [["nickname", "guestbook-nickname"], ["email", "guestbook-email"], ["content", "guestbook-content"]]) {
    assert.match(board, new RegExp(`htmlFor="${id}"`), `${label} 的 label 没有 htmlFor`);
    assert.match(board, new RegExp(`id="${id}"`), `${label} 的控件没有 id`);
  }
});

test("提交结果（成功/失败）要被播报", async () => {
  const board = await read("src/components/GuestbookBoard.tsx");
  assert.match(board, /role="status"/);
  assert.match(board, /aria-live="polite"/);
});

test("巡检规则集要同时覆盖中英文留言板，门禁快检也包含它", async () => {
  const check = await read("scripts/check-a11y.mjs");
  assert.match(check, /"\/guestbook\/"/);
  assert.match(check, /"\/en\/guestbook\/"/, "英文留言板此前不在巡检清单里");
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["check:a11y:fast"], /guestbook/);
});
