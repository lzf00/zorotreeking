#!/usr/bin/env node
/**
 * 刷新 `/invest/us-market/` 的行情块（东方财富公开延迟行情，无需 key）——第 137 轮。
 *
 * 用法：
 *   node scripts/fetch-us-quotes.mjs            # 抓取并写入（数据没变就不写）
 *   node scripts/fetch-us-quotes.mjs --dry-run  # 只打印
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildMarketBlocks, secidCandidates } from "./lib/us-quotes-compute.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_FILE = path.join(ROOT, "src/data/us-market-latest.json");
const ENDPOINT = "https://push2.eastmoney.com/api/qt/stock/get";
const FIELDS = "f43,f57,f58,f59,f60,f86,f169,f170";
const UA = "Mozilla/5.0 (compatible; ZoroTreekingQuoteRefresh/1.0)";
const CONCURRENCY = 4;

const GROUPS = { indices: "index", sectors: "etf", companies: "stock" };

async function fetchOne(symbol, kind) {
  let lastError = null;
  for (const secid of secidCandidates(symbol, kind)) {
    const url = `${ENDPOINT}?secid=${encodeURIComponent(secid)}&fields=${FIELDS}`;
    const response = await fetch(url, {
      headers: { "user-agent": UA, referer: "https://quote.eastmoney.com/" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      lastError = new Error(`${symbol} HTTP ${response.status}`);
      continue;
    }
    const payload = await response.json();
    if (payload?.data) return payload;
    lastError = new Error(`${symbol} 无数据（${secid}）`);
  }
  throw lastError ?? new Error(`${symbol} 无数据`);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await worker(items[index]);
        } catch (error) {
          results[index] = { error: String(error?.message ?? error) };
        }
      }
    }),
  );
  return results;
}

function sameBlocks(a, b) {
  if (!a || !b) return false;
  const flat = (block) => Object.values(block).flat().map((row) => `${row.symbol}:${row.price}:${row.change_pct}`);
  return ["indices", "sectors", "companies"].every((key) => JSON.stringify(flat(a[key] ?? [])) === JSON.stringify(flat(b[key] ?? [])));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const current = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const previous = {
    indices: current.market?.indices ?? [],
    sectors: current.market?.sectors ?? [],
    companies: current.market?.companies ?? [],
  };

  const tasks = Object.entries(GROUPS).flatMap(([group, kind]) =>
    (previous[group] ?? []).map((item) => ({ group, kind, symbol: item.symbol })),
  );
  const responses = await mapLimit(tasks, CONCURRENCY, async (task) => fetchOne(task.symbol, task.kind));
  const rawByGroup = {};
  tasks.forEach((task, index) => {
    const payload = responses[index];
    (rawByGroup[task.group] ??= {})[task.symbol] = payload && !payload.error ? payload : null;
  });

  const blocks = buildMarketBlocks(previous, rawByGroup, { now: Math.floor(Date.now() / 1000) });
  if (blocks.succeeded === 0) {
    console.error("✗ 一个报价都没抓到，保持原文件不动（避免把页面刷成空白）");
    process.exit(1);
  }

  if (sameBlocks(previous, blocks)) {
    console.log(`= 行情块没有变化（${blocks.succeeded}/${blocks.requested} 只，最新 ${new Date(blocks.quote_ts * 1000).toISOString()}）`);
    return;
  }

  const next = {
    ...current,
    ts: blocks.quote_ts,
    market: {
      ...current.market,
      ...blocks,
      fetched_at: Math.floor(Date.now() / 1000),
    },
    // 宏观块是否陈旧由它自己的 stale 字段表达；顶层只在行情也新鲜时才算新鲜
    stale: (current.macro?.stale ?? true) || blocks.partial,
    partial: (current.macro == null) || blocks.partial,
  };

  const summary = `${blocks.succeeded}/${blocks.requested} 只 · SPX ${blocks.indices[0]?.price ?? "—"} · AAPL ${blocks.companies[0]?.price ?? "—"}`;
  if (dryRun) {
    console.log(JSON.stringify({ indices: blocks.indices.slice(0, 2), companies: blocks.companies.slice(0, 2) }, null, 2));
    console.log(summary);
    return;
  }
  writeFileSync(DATA_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✓ 行情块已刷新：${summary}${blocks.problems.length > 0 ? `（缺失：${blocks.problems.join(",")}）` : ""}`);
}

try {
  await main();
} catch (error) {
  console.error(`✗ 行情抓取失败：${error?.message ?? error}`);
  process.exit(1);
}
