/**
 * 公开的更新日志不能变成内部提交的流水账（第 109 轮）。
 *
 * 线上 `/changelog/` 上能看到这类条目：`test catch workflows that die before job 1`、
 * `ops probe the whole /api surface`，徽章还挂着未翻译的 `test` / `ops`。
 * 根因是 `TYPE_LABEL[type] ?? { show: true }` —— **没登记的 type 默认显示**，
 * 于是每加一种提交前缀就自动泄漏一次，没人会注意。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { TYPE_STYLES, buildChangelog, isVisible, parseGitLog, type Commit } from "../src/lib/changelog";

const commit = (type: string, subject: string, date = "2026-11-21"): Commit => ({
  hash: "abc1234",
  date,
  subject,
  type,
});

test("内部工程提交不展示，读者在意的改动展示", () => {
  for (const type of ["test", "ci", "ops", "chore", "build", "deps", "refactor"]) {
    assert.equal(isVisible(commit(type, "whatever")), false, `${type} 不该出现在公开更新日志里`);
  }
  for (const type of ["feat", "fix", "perf", "style", "a11y", "seo", "i18n", "content"]) {
    assert.equal(isVisible(commit(type, "whatever")), true, `${type} 是读者在意的改动，应该展示`);
  }
});

test("没登记的 type 默认隐藏（这是当年泄漏的根因）", () => {
  assert.equal(isVisible(commit("somethingnew", "internal thing")), false);
  assert.equal(TYPE_STYLES.somethingnew, undefined);
});

test("自动化产出的提交句式中任何 type 都要滤掉", () => {
  assert.equal(isVisible(commit("feat", "add daily auto digest")), false);
  assert.equal(isVisible(commit("fix", "market recap 2026-11-20")), false);
  assert.equal(isVisible(commit("perf", "refresh embeddings")), false);
});

test("按月倒序分组，并报出隐藏条数（透明度）", () => {
  const result = buildChangelog([
    commit("feat", "新功能 A", "2026-11-21"),
    commit("test", "内部测试", "2026-11-20"),
    commit("fix", "修了个 bug", "2026-10-03"),
    commit("ops", "运维脚本", "2026-09-01"),
  ]);
  assert.deepEqual(result.sections.map((s) => s.month), ["2026-11", "2026-10"]);
  assert.deepEqual(result.sections[0].commits.map((c) => c.subject), ["新功能 A"]);
  assert.equal(result.visibleCount, 2);
  assert.equal(result.hiddenCount, 2);
});

test("git log 解析：抽出 conventional 前缀，没有前缀的算 other", () => {
  const parsed = parseGitLog(
    ["a1b2c3d|2026-11-21|fix(home): featured card is fresh now", "e4f5a6b|2026-11-20|随手改了点东西"].join("\n"),
  );
  assert.deepEqual(parsed[0], {
    hash: "a1b2c3d",
    date: "2026-11-21",
    subject: "featured card is fresh now",
    type: "fix",
  });
  assert.equal(parsed[1].type, "other");
  assert.equal(isVisible(parsed[1]), false, "没有前缀的提交也默认隐藏，避免误伤");
});
