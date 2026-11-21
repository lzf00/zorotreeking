/**
 * `docs/known-debt.md` 里的数字必须是真的（第 122 轮）。
 *
 * 一份"追踪欠账"的文档最怕的情况是：数字早就变了，但没人更新，于是它变成装饰品。
 * 这里把文档里的关键数字和仓库里的真实数据对起来，对不上就红。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ageRows } from "../scripts/check-market-data-age.mjs";

const DOC = new URL("../docs/known-debt.md", import.meta.url);

async function doc() {
  return readFile(DOC, "utf8");
}

test("英文页中文残留的数字与 baseline 一致", async () => {
  const baseline = JSON.parse(await readFile(new URL("../scripts/i18n-leaks-baseline.json", import.meta.url), "utf8"));
  const files = Object.keys(baseline).length;
  const hits = Object.values(baseline).reduce((sum: number, n: any) => sum + n, 0);
  const text = await doc();
  assert.match(text, new RegExp(`\\*\\*${files} 个文件 / ${hits} 处\\*\\*`), `文档里的数字与 baseline（${files} / ${hits}）不一致`);
});

test("日报缺摘要的期数/条数与实际内容一致", async () => {
  const { readdir, readFile: rf } = await import("node:fs/promises");
  let periods = 0;
  let items = 0;
  for (const stream of ["ai", "invest"]) {
    const dir = new URL(`../src/content/${stream}/`, import.meta.url);
    for (const file of await readdir(dir)) {
      if (!/^digest-\d{4}-\d{2}-\d{2}\.zh\.mdx$/.test(file)) continue;
      const raw = await rf(new URL(file, dir), "utf8");
      const body = raw.split("---").slice(2).join("---");
      const sections = body.split(/^## /m).slice(1);
      const missing = sections.filter((section) => {
        const lines = section.split("\n").slice(1).map((line) => line.trim());
        return !lines.some((line) => line.length > 0 && !/^[*<>!\-|#(（]/.test(line));
      }).length;
      if (missing > 0) {
        periods += 1;
        items += missing;
      }
    }
  }
  const text = await doc();
  assert.match(text, new RegExp(`\\*\\*${periods} 期 / ${items} 条\\*\\*`), `文档写的是别的数字，实测 ${periods} 期 / ${items} 条`);
});

test("快照过旧的行数与文档描述一致（第 137 轮起美股两块都由 Actions 刷新，应为空）", async () => {
  const { SNAPSHOTS } = await import("../scripts/check-market-data-age.mjs");
  const cache = new Map<string, any>();
  const withAt = [];
  for (const snap of SNAPSHOTS) {
    if (!cache.has(snap.file)) {
      cache.set(snap.file, JSON.parse(await readFile(new URL(`../src/data/${snap.file}`, import.meta.url), "utf8")));
    }
    withAt.push({ file: snap.file, label: snap.label, maxAgeDays: snap.maxAgeDays, at: () => snap.at(cache.get(snap.file)) });
  }
  const stale = ageRows(withAt).filter((row: any) => row.stale).map((row: any) => row.label);
  // 2026-11-22：宏观（BLS，第 136 轮）与行情（东方财富，第 137 轮）都由
  // `Refresh US market data` 工作流每天刷新，不再有过旧快照。
  // 这里保持"清单为空"的断言：一旦哪块又停了，测试会先把人叫醒。
  assert.deepEqual(stale, [], "又有快照过旧了：先看 Refresh US market data 工作流");
});

test("已修复的欠账不该还留在表里", async () => {
  const text = await doc();
  // 这几条是第 113–121 轮修掉的，不能又出现在欠账表里
  assert.doesNotMatch(text, /摘要失败，请稍后手动补充/);
  assert.doesNotMatch(text, /搜索索引缺失/);
});
