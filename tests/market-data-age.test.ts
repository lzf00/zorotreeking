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

import { ageRows, beijingDateMs } from "../scripts/check-market-data-age.mjs";

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
    // optional 的快照允许"现在没有数据"（第 160 轮：过期的一致预期会被作废），
    // 但不能出现"字段读不出来"—— 那是字段改名。
    if (snap.optional && Number.isNaN(ms)) continue;
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

test("ETF 分析：只在交易日跑，5 天内不算旧（周末不断更误报）", () => {
  // 2026-11-20 是周五；周日晚上看，差 2 天，不该报旧
  const rows = ageRows(
    [{ file: "etf.json", label: "ETF 三因子分析", at: beijingDateMs("2026-11-20"), maxAgeDays: 5 }],
    { now: Date.parse("2026-11-22T20:00:00+08:00") },
  );
  assert.equal(rows[0].ageDays, 2);
  assert.equal(rows[0].stale, false);
  assert.equal(rows[0].maxAgeDays, 5, "每行阈值要能覆盖全局默认值");
});

test("ETF 分析连续 6 天没跑：判旧", () => {
  const rows = ageRows(
    [{ file: "etf.json", label: "ETF 三因子分析", at: beijingDateMs("2026-11-15"), maxAgeDays: 5 }],
    { now: Date.parse("2026-11-21T08:00:00Z") },
  );
  assert.equal(rows[0].stale, true);
});

test("没有时区的日期按北京时间零点解释，不随运行环境漂", () => {
  assert.equal(beijingDateMs("2026-11-20"), Date.parse("2026-11-20T00:00:00+08:00"));
  assert.ok(Number.isNaN(beijingDateMs(undefined)));
});

test("ETF 页面真的把「几天前」显示出来了（不是只算不用）", async () => {
  const page = await readFile(new URL("../src/pages/invest/etf.astro", import.meta.url), "utf8");
  assert.match(page, /analysisAge/, "页面没算分析日年龄");
  assert.match(page, /humanAge\(analysisAge\.days\)/, "算了却没显示");
  assert.match(page, /analysisAge\.severe/, "超过阈值要出横幅");
});

test("看门狗覆盖 ETF 分析，且给了它自己的阈值", async () => {
  const { SNAPSHOTS } = await import("../scripts/check-market-data-age.mjs");
  const etf = SNAPSHOTS.find((snap: any) => snap.file === "etf-three-factor-latest.json");
  assert.ok(etf, "ETF 分析没进看门狗");
  assert.equal(etf.maxAgeDays, 5);
});

// ── 第 159 轮：一致预期单独盯，且只警告不挡发布 ─────────────────────────────

test("一致预期进看门狗：停在 2026-08-07 的那块数据不再隐形", async () => {
  const source = await readFile(new URL("../scripts/check-market-data-age.mjs", import.meta.url), "utf8");
  assert.match(source, /macro\?\.consensus\?\.updated_at/, "要读一致预期自己的时间戳");
  assert.match(source, /label: "美国宏观一致预期"/, "报告里要单独一行");
});

test("warn 级条目不会挡住发布（否则每周巡检变成恒红）", async () => {
  const source = await readFile(new URL("../scripts/check-market-data-age.mjs", import.meta.url), "utf8");
  // 失败判定必须排除 warn
  assert.match(source, /row\.stale && row\.severity !== "warn"/, "fail 判定要跳过 warn");
  assert.match(source, /severity: "warn"/, "一致预期要标成 warn");
});

test("ageRows 把 severity 透传出来，默认是 fail", () => {
  const rows = ageRows(
    [
      { file: "a.json", label: "普通", at: at("2026-09-01T00:00:00+08:00") },
      { file: "b.json", label: "警告级", at: at("2026-09-01T00:00:00+08:00"), severity: "warn" },
    ],
    { now: NOW },
  );
  assert.equal(rows[0].severity, "fail");
  assert.equal(rows[1].severity, "warn");
  assert.equal(rows[0].stale, true);
  assert.equal(rows[1].stale, true);
});

test("界面上必须写出一致预期的时间（106 天的数据不能和 BLS 实际值并排装新）", async () => {
  const dashboard = await readFile(
    new URL("../src/components/UsMarketDashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /describeIsoSnapshot\(macro\?\.consensus\?\.updated_at/, "要算一致预期的年龄");
  // 第 216 轮：consensusAge 改成挂载后才算（跨天访问否则会 hydration mismatch），
  // 因此渲染处是可选链；「陈旧必须提示」这条要求本身不变。
  assert.match(dashboard, /consensusAge\?\.severe/, "陈旧时要在界面上提示");
  const { describeIsoSnapshot } = await import("../src/lib/snapshot-age.ts");
  const stale = describeIsoSnapshot("2026-08-07T13:00:00Z", new Date("2026-11-21T08:00:00Z"), {
    severeAfterDays: 60,
  });
  assert.equal(stale.severe, true);
  assert.ok((stale.days ?? 0) > 100);
  const fresh = describeIsoSnapshot("2026-11-20T13:00:00Z", new Date("2026-11-21T08:00:00Z"), {
    severeAfterDays: 60,
  });
  assert.equal(fresh.severe, false);
});

test("optional 行：数据不存在不等于过旧（第 160 轮起过期预期会被作废）", () => {
  const rows = ageRows(
    [
      { file: "a.json", label: "必需但缺失", at: () => Number.NaN },
      { file: "b.json", label: "可选且缺失", at: () => Number.NaN, optional: true },
    ],
    { now: NOW },
  );
  assert.equal(rows[0].stale, true, "必需字段缺失要报");
  assert.equal(rows[1].stale, false, "可选字段缺失不报，否则每周都红");
  assert.equal(rows[1].ageDays, null);
});
