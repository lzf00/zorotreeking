/**
 * /now 页必须"过期就说自己过期"（第 110 轮）。
 *
 * 线上实测：这一页写着「最后更新 · 2026-07-07」，而站点当天是 11-21 —— 四个多月没动，
 * 却仍然用"记录此时此刻手头的事"的口吻展示。页面可以旧，但不能**假装不旧**。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { STALE_AFTER_DAYS, nowStaleness, recentChanges } from "../src/lib/now";
import { readGitLog, type Commit } from "../src/lib/changelog";

test("超过阈值必须明确说过期了，并给出天数", () => {
  const stale = nowStaleness("2026-07-07", "2026-11-21");
  assert.equal(stale.stale, true);
  assert.equal(stale.days, 137);
  assert.match(stale.notice!, /137 天没更新/);
  assert.match(stale.notice!, /不是今天的状态/, "要说明那是旧近况，不是现状");
});

test("阈值内不打扰读者", () => {
  assert.equal(nowStaleness("2026-11-01", "2026-11-21").stale, false);
  const exact = nowStaleness("2026-10-07", "2026-11-21"); // 恰好 45 天
  assert.equal(exact.days, STALE_AFTER_DAYS);
  assert.equal(exact.stale, false, "刚好卡在阈值上不该报警");
  assert.equal(nowStaleness("2026-10-06", "2026-11-21").stale, true, "46 天就该报了");
});

test("将来的日期不会算出负数天", () => {
  const future = nowStaleness("2026-12-01", "2026-11-21");
  assert.equal(future.days, 0);
  assert.equal(future.stale, false);
});

test("最近的改动只取窗口内、读者可见的提交，并按上限截断", () => {
  const commits: Commit[] = [
    { hash: "aaaaaaa", date: "2026-11-21", subject: "首页精选修好了", type: "fix" },
    { hash: "bbbbbbb", date: "2026-11-20", subject: "内部流水线", type: "test" },
    { hash: "ccccccc", date: "2026-09-01", subject: "很久以前的功能", type: "feat" },
    { hash: "ddddddd", date: "2026-11-19", subject: "加了深色模式", type: "feat" },
  ];
  const recent = recentChanges(commits, { todayIso: "2026-11-21", days: 30, limit: 5 });
  assert.deepEqual(recent.map((r) => r.hash), ["aaaaaaa", "ddddddd"], "内部提交和超窗口的都要排除");
  assert.equal(recent[0].label, "修复");
  assert.equal(recentChanges(commits, { todayIso: "2026-11-21", days: 30, limit: 1 }).length, 1);
});

test("构建环境里真的能读到 git 历史（否则自动生成那部分会静默变空）", () => {
  const log = readGitLog();
  assert.ok(log.length > 100, `只读到 ${log.length} 条提交，浅克隆会让 /now 和 /changelog 都变空`);
  assert.ok(log.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)), "日期格式应为 YYYY-MM-DD");
});

// ── 第 181 轮：过期提示不能是死路 ────────────────────────────────────────
//
// /now 已经 138 天没更新，页面老老实实说了「这一页已经 N 天没更新」—— 但说完就完了，
// 读者看到"过期"却没有下一站。诚实不等于有用：过期提示里必须给能看的地方。

test("过期提示把读者送到能看的地方（构建产物里验证）", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../dist/now/index.html", import.meta.url), "utf8");
  assert.match(html, /能看的地方/, "过期提示里要有出口");
  assert.match(html, /<a href="\/changelog\/"/, "更新日志要能点");
  assert.match(html, /<a href="#recent"/, "本页的自动改动要能点（锚点）");
  assert.match(html, /id="recent"/, "锚点目标必须真的存在");
  assert.doesNotMatch(html, /href="\/now\/"[^>]*>再过一阵再来/, "不许自指链接");
});
