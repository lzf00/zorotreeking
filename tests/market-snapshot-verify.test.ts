/**
 * 行情快照的发布闸门（第 146 轮）。
 *
 * 背景：`deploy.yml` 新增「快照过旧就自动重抓」的自愈步骤。抓取脚本退出 0
 * 不代表内容可用 —— BLS 只回一半、行情 23 只里只抓到 3 只、宏观块自己标 stale，
 * 这些都会让页面上一半新一半旧且不报错。所以提交前过 `verifySnapshot`。
 *
 * 宁可留旧但完整的一份，也不发半成品。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { verifySnapshot } from "../scripts/verify-us-market-snapshot.mjs";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const good = () => ({
  ok: true,
  stale: false,
  macro: {
    fetched_at: 1_795_282_908,
    stale: false,
    cpi: { reference: "2026-09", actual: 3.7 },
    core_cpi: { reference: "2026-09", actual: 2.6 },
  },
  market: { quote_ts: 1_795_208_400, requested: 23, succeeded: 23, indices: [{ price: 6910.1 }] },
});

test("完整快照可以发布（仓里这份也要过）", async () => {
  assert.deepEqual(verifySnapshot(good()), { ok: true, problems: [] });
  const real = JSON.parse(await read("src/data/us-market-latest.json"));
  assert.deepEqual(verifySnapshot(real).problems, [], "仓库里的快照本身就过不了闸门");
});

test("标了 stale 的一律不能发", () => {
  const data = good();
  data.stale = true;
  assert.equal(verifySnapshot(data).ok, false);
  const macroStale = good();
  macroStale.macro.stale = true;
  assert.match(verifySnapshot(macroStale).problems.join(), /宏观数据被标记为 stale/);
});

test("缺块 / 缺关键数字 / 一条行情都没抓到时拦住", () => {
  const noMacro: any = good();
  delete noMacro.macro;
  assert.match(verifySnapshot(noMacro).problems.join(), /缺少 macro/);

  const badCpi = good();
  badCpi.macro.cpi = { reference: "2026-09" } as never;
  assert.match(verifySnapshot(badCpi).problems.join(), /cpi\.actual/);

  const badRef = good();
  badRef.macro.cpi.reference = "2026/09";
  assert.match(verifySnapshot(badRef).problems.join(), /YYYY-MM/);

  const noQuotes = good();
  noQuotes.market.indices = [];
  assert.match(verifySnapshot(noQuotes).problems.join(), /indices 为空/);

  const noneSucceeded = good();
  noneSucceeded.market.succeeded = 0;
  assert.match(verifySnapshot(noneSucceeded).problems.join(), /一条都没抓到/);
});

test("自愈步骤存在，且顺序正确（判旧 → 抓 → 验 → 提交）", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  const start = workflow.indexOf("Refresh stale market data (self-healing)");
  assert.ok(start > 0, "deploy.yml 里没有行情自愈步骤");
  const block = workflow.slice(start);
  // 匹配 `node scripts/...` 的实际调用，别被注释里提到的文件名骗了（第一次就栽在这）
  const order = [
    "node scripts/check-market-data-age.mjs --json --max-age=2",
    "node scripts/fetch-us-quotes.mjs",
    "node scripts/fetch-us-macro.mjs",
    "node scripts/verify-us-market-snapshot.mjs",
    "git commit",
  ].map((needle) => block.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), `步骤里缺少某个调用：${order}`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], "顺序必须是 判旧 → 抓行情 → 抓宏观 → 验完整性 → 提交");
  }
  // 验不过要回滚，不能把半成品提交出去
  assert.match(block, /git checkout -- src\/data/);
});

test("抓取脚本失败时给一行原因，不甩堆栈", async () => {
  for (const file of ["scripts/fetch-us-quotes.mjs", "scripts/fetch-us-macro.mjs"]) {
    const script = await read(file);
    assert.match(script, /catch \(error\)/, `${file} 没有顶层 catch`);
    assert.match(script, /✗ .*抓取失败/, `${file} 的失败提示不是一行结论`);
  }
  const macro = await read("scripts/fetch-us-macro.mjs");
  assert.match(macro, /RETRYABLE/, "BLS 503/429 是瞬时错误，应该重试一次");
});

// ── 第 186 轮：坏快照不许进仓库，也不许卡死部署 ──────────────────────────
test("刷新工作流先过闸门再提交（抓了一半的数据不许进仓库）", async () => {
  const { readFile } = await import("node:fs/promises");
  const wf = await readFile(new URL("../.github/workflows/refresh-us-macro.yml", import.meta.url), "utf8");
  const verify = wf.indexOf("verify-us-market-snapshot.mjs");
  const commit = wf.indexOf('git commit -m "chore(us-market)');
  assert.ok(verify > 0, "提交前必须校验快照完整性");
  assert.ok(commit > 0 && verify < commit, "校验要排在提交之前");
  assert.match(wf, /git checkout -- src\/data\/us-market-latest\.json/, "不合格要丢弃本次结果，保留原来那份");
});

test("部署流程在跑测试前修复仓库里的坏快照", async () => {
  const { readFile } = await import("node:fs/promises");
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const repair = wf.indexOf("node scripts/repair-us-snapshot.mjs");
  const tests = wf.indexOf("name: Unit and guard tests");
  assert.ok(repair > 0, "部署里要有快照修复步骤");
  assert.ok(tests > 0 && repair < tests, "修复必须排在单元测试之前，否则测试照样红");
});
