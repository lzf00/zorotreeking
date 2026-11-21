#!/usr/bin/env node
/**
 * 刷新 `/invest/us-market/` 的宏观块（BLS 官方公开 API，无需 key）——第 136 轮。
 *
 * 只改 `src/data/us-market-latest.json` 里的 `macro` 字段：行情块（东方财富延迟行情）
 * 不在本仓库的采集范围内，保持原样并沿用它的 `stale` 标记。
 *
 * 用法：
 *   node scripts/fetch-us-macro.mjs            # 抓取并写入（数据没变就不写）
 *   node scripts/fetch-us-macro.mjs --dry-run  # 只打印将要写入的内容
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BLS_SERIES, computeUsMacro } from "./lib/us-macro-compute.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_FILE = path.join(ROOT, "src/data/us-market-latest.json");
const BLS_ENDPOINT = "https://api.bls.gov/publicAPI/v1/timeseries/data/";
const UA = "ZoroTreekingMacroRefresh/1.0 (+https://www.zorotreeking.online/invest/us-market/)";

async function fetchBls() {
  const now = new Date();
  const body = {
    seriesid: Object.values(BLS_SERIES),
    startyear: String(now.getUTCFullYear() - 2),
    endyear: String(now.getUTCFullYear()),
  };
  const response = await fetch(BLS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BLS HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS 返回 ${payload?.status}: ${JSON.stringify(payload?.message ?? []).slice(0, 200)}`);
  }
  const byId = new Map((payload?.Results?.series ?? []).map((series) => [series.seriesID, series.data ?? []]));
  return {
    cpi: byId.get(BLS_SERIES.cpi),
    core_cpi: byId.get(BLS_SERIES.core_cpi),
    unemployment: byId.get(BLS_SERIES.unemployment),
    payroll: byId.get(BLS_SERIES.payroll),
  };
}

function sameMacro(a, b) {
  if (!a || !b) return false;
  const keys = ["cpi", "core_cpi", "payroll", "unemployment"];
  return keys.every((key) => a[key]?.reference === b[key]?.reference && a[key]?.actual === b[key]?.actual)
    && a.consensus?.updated_at === b.consensus?.updated_at;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const current = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  // 旧数据里的 expected 只在参考期完全相同时才沿用（否则新月份的"预期"是假的）
  const carryExpected = {
    cpi: current.macro?.cpi,
    core_cpi: current.macro?.core_cpi,
    payroll: current.macro?.payroll,
    unemployment: current.macro?.unemployment,
    consensus: current.macro?.consensus,
    consensusMatches: (current.macro?.consensus?.updated_at ?? "") >= `${new Date().getUTCFullYear()}-`,
  };

  const raw = await fetchBls();
  const result = computeUsMacro(raw, { fetchedAt: Math.floor(Date.now() / 1000), carryExpected });
  if (!result.ok) {
    console.error(`✗ 宏观块没更新：${result.error}`);
    process.exit(1);
  }

  if (sameMacro(current.macro, result.macro)) {
    console.log(`= 宏观块没有变化（CPI ${result.macro.cpi.reference} / 非农 ${result.macro.payroll.reference}）`);
    return;
  }

  const next = {
    ...current,
    ts: result.macro.fetched_at,
    // 行情块还是旧的，整体仍然是"部分陈旧"：顶层 stale 跟随行情块，宏观块自己标记已刷新
    stale: current.market?.stale ?? true,
    macro: result.macro,
  };
  if (dryRun) {
    console.log(JSON.stringify(next.macro, null, 2));
    return;
  }
  writeFileSync(DATA_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✓ 宏观块已刷新：CPI ${result.macro.cpi.reference} ${result.macro.cpi.actual}% · `
    + `核心 ${result.macro.core_cpi.actual}% · 非农 ${result.macro.payroll.reference} ${result.macro.payroll.actual}k · `
    + `失业率 ${result.macro.unemployment.actual}%`);
}

await main();
