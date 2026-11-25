/**
 * 欠账文档的数字由内容算出来，不再靠人手追（第 201 轮）。
 *
 * 事故：2026-11-24/25 `daily-digest` 连续四次挂在 `Unit and guard tests`，线上两天没更新。
 * 根因不是代码 —— 日报流水线新产出一期缺摘要内容，文档里的「38 期 / 299 条」过期，
 * `tests/known-debt.test.ts` 红 → `npm test` 红 → 部署被拦。**一个每天变的业务指标把
 * 整站发布卡死了。** 修法是让数字自己长出来（`npm test` 的 `pretest` 先跑同步脚本）。
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { digestDebtFrom, i18nLeakNumbers, syncDoc } from "../scripts/sync-known-debt.mjs";

const digest = (sections: string) => `---\ntitle: x\n---\n\n${sections}`;
const filled = "## 结论\n\n这里有一句正文。\n";
// "缺摘要"的口径：除标记行外没有正文（只有一条链接列表项）
const empty = "## 结论\n\n- [看原文](https://example.com)\n";

test("digestDebt：整期全空与部分缺分开统计", () => {
  const files = [
    digest(`${empty}${empty}`), // 整期全空：2 条
    digest(`${filled}${empty}`), // 部分缺：1 条
    digest(`${filled}${filled}`), // 不缺
  ];
  const debt = digestDebtFrom(files);
  assert.deepEqual(debt, { periods: 2, items: 3, wholeEmpty: 1, partial: 1 });
});

test("digestDebt：只靠链接/标记行不算正文", () => {
  const debt = digestDebtFrom([digest("## 结语\n\n- [链接](https://a.example)\n- **加粗**\n")]);
  assert.equal(debt.periods, 1, "只有链接和加粗的小节应算缺摘要");
});

test("i18nLeakNumbers：文件数与处数分别求和", () => {
  assert.deepEqual(i18nLeakNumbers({ "a.mdx": 2, "b.mdx": 5 }), { files: 2, hits: 7 });
  assert.deepEqual(i18nLeakNumbers({}), { files: 0, hits: 0 });
  assert.deepEqual(i18nLeakNumbers(null), { files: 0, hits: 0 });
});

test("syncDoc：改数字、留历史说明，其他行不动", () => {
  const text = [
    "# 已知欠账",
    "",
    "| 2 | 日报缺摘要 | **38 期 / 299 条**（20 期整期全空，18 期部分缺） | 读者看到标题+链接 |",
    "| 1 | 英文页中文残留 | **0 个文件 / 0 处**（第 185 轮清零，此前 20 / 115） | 无 |",
    "",
    "内容更新于 39 期 / 300 条。",
  ].join("\n");
  const { text: out, changes } = syncDoc(text, {
    debt: { periods: 39, items: 300, wholeEmpty: 20, partial: 19 },
    leaks: { files: 0, hits: 0 },
  });
  assert.equal(changes.length, 1, "只有日报那行该变（残留本来就是 0/0）");
  assert.match(out, /\*\*39 期 \/ 300 条\*\*（20 期整期全空，19 期部分缺）/);
  assert.match(out, /（第 185 轮清零，此前 20 \/ 115）/, "括号里的历史说明必须保留");
  assert.match(out, /内容更新于 39 期 \/ 300 条。/, "正文里的同款数字不许被误改");
});

test("syncDoc：数字已经对了就一个字都不改（幂等）", () => {
  const text = "| 2 | 日报缺摘要 | **39 期 / 300 条**（20 期整期全空，19 期部分缺） |";
  const numbers = { debt: { periods: 39, items: 300, wholeEmpty: 20, partial: 19 }, leaks: { files: 0, hits: 0 } };
  const once = syncDoc(text, numbers);
  assert.equal(once.changes.length, 0);
  assert.equal(once.text, text);
});

test("npm test 之前会自动同步（pretest），不靠人记得跑", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.pretest ?? "", /sync-known-debt\.mjs/, "pretest 必须跑同步脚本");
  assert.equal(pkg.scripts.test, "node --import tsx --test tests/*.test.ts", "test 本身保持不变");
  assert.match(pkg.scripts["check:debt"] ?? "", /--check/, "另给一个只检查的入口");
});

test("同步脚本在临时仓库上真的能改对（端到端）", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "debt-sync-"));
  const { mkdir, readFile } = await import("node:fs/promises");
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await mkdir(path.join(dir, "src", "content", "ai"), { recursive: true });
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  await writeFile(
    path.join(dir, "docs", "known-debt.md"),
    "| 2 | 日报缺摘要 | **1 期 / 1 条**（1 期整期全空，0 期部分缺） |\n",
  );
  await writeFile(path.join(dir, "src", "content", "ai", "digest-2026-01-01.zh.mdx"), digest(`${empty}${filled}`));
  await writeFile(path.join(dir, "scripts", "i18n-leaks-baseline.json"), "{}");
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(process.execPath, ["scripts/sync-known-debt.mjs", `--root=${dir}`], {
    cwd: path.dirname(new URL("../package.json", import.meta.url).pathname),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const after = await readFile(path.join(dir, "docs", "known-debt.md"), "utf8");
  assert.match(after, /\*\*1 期 \/ 1 条\*\*（0 期整期全空，1 期部分缺）/, "整期全空/部分缺要按实际算");
});
