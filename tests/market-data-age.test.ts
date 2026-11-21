/**
 * 行情快照年龄看门狗（第 117 轮）。
 *
 * 起因：`us-market-latest.json` 里的 BLS 宏观块停在 2026-08-11，**101 天**没人发现 ——
 * 构建成功、门禁全绿、页面照常打开，只是数字是三个月前的。和内容停更同一类静默故障。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import { ageRows } from "../scripts/check-market-data-age.mjs";

const NOW = Date.parse("2026-11-21T08:00:00Z");
const at = (iso: string) => () => Date.parse(iso);

test("刚更新过的不算旧", () => {
  // 2026-11-20 16:30 北京 = 08:30Z；NOW 是 11-21 16:00 北京 —— 只差 23.5 小时，按整天算是 0
  const rows = ageRows([{ file: "a.json", label: "A 股", at: at("2026-11-20T16:30:00+08:00") }], { now: NOW });
  assert.equal(rows[0].ageDays, 0);
  assert.equal(rows[0].stale, false);
});

test("隔一天就是 1 天（整天向下取整，不四舍五入）", () => {
  const rows = ageRows([{ file: "a.json", label: "A 股", at: at("2026-11-19T16:30:00+08:00") }], { now: NOW });
  assert.equal(rows[0].ageDays, 1);
  assert.equal(rows[0].stale, false);
});

test("101 天前的宏观块必须判旧（线上真实形态）", () => {
  const rows = ageRows([{ file: "us.json", label: "美国宏观（BLS）", at: at("2026-08-11T14:00:31Z") }], { now: NOW });
  assert.equal(rows[0].ageDays, 101);
  assert.equal(rows[0].stale, true);
});

test("阈值可调：3 天阈值下 5 天的快照算旧", () => {
  const rows = ageRows([{ file: "a.json", label: "A 股", at: at("2026-11-16T16:30:00+08:00") }], { now: NOW, maxAgeDays: 3 });
  assert.equal(rows[0].stale, true);
});

test("时间字段缺失/坏值算旧而不是静默放过", () => {
  const rows = ageRows([{ file: "x.json", label: "未知", at: () => Number.NaN }], { now: NOW });
  assert.equal(rows[0].ageDays, null);
  assert.equal(rows[0].stale, true, "读不出时间等于无法证明它新鲜");
});

test("真实的四个快照都能读出时间（防止字段改名后静默失效）", async () => {
  const { SNAPSHOTS } = await import("../scripts/check-market-data-age.mjs");
  const cache = new Map<string, any>();
  for (const snap of SNAPSHOTS) {
    if (!cache.has(snap.file)) {
      cache.set(snap.file, JSON.parse(await readFile(new URL(`../src/data/${snap.file}`, import.meta.url), "utf8")));
    }
    const ms = snap.at(cache.get(snap.file));
    assert.ok(Number.isFinite(ms), `${snap.label} 的时间字段读不出来（字段名是不是改了？）`);
  }
});

test("接线：npm 脚本 + 每周巡检都跑它，但不进阻塞门禁", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["check:market-age"], "node scripts/check-market-data-age.mjs");
  assert.doesNotMatch(pkg.scripts.gate, /market-age/, "它现在就是红的（后端问题），不该卡住部署");

  const audit = parse(await readFile(new URL("../.github/workflows/site-audit.yml", import.meta.url), "utf8"));
  const steps = JSON.stringify(audit.jobs);
  assert.match(steps, /check-market-data-age/);
});
