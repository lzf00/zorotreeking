#!/usr/bin/env node
/**
 * 站内搜索探针：pagefind 的索引和碎片必须**全部可读**，否则搜索对用户就是坏的。
 *
 * 背景（第 80 轮）：生产上 20 个常见查询里有 4 个直接报错：
 *   Error: 403 fetching /pagefind/fragment/zh-cn_XXX.pf_fragment
 * 关键线索是状态码：随便编一个不存在的碎片名返回 **404**（Astro 的 404 页），
 * 而这 4 个固定名字稳定返回 **403**（nginx 的 146 字节错误页）—— 说明文件在，
 * 只是 nginx 读不了（权限位）。部署用 `rsync --no-perms` + `cp -al` 硬链接播种，
 * 一有小概率文件落到 `0600`，搜索就会对**部分**关键词坏掉，而站点其他部分完全正常，
 * 所以既有的烟测都发现不了。
 *
 * 这个探针按真实前端路径跑：加载页面 → import("/pagefind/pagefind.js") → 逐个查询。
 * 只把**报错**算失败；某词恰好 0 结果只是警告（那是内容问题，不是交付问题）。
 *
 * 用法：
 *   node scripts/check-search.mjs                                  # 打线上
 *   node scripts/check-search.mjs --base=http://127.0.0.1:4321    # 打本地 build
 *   node scripts/check-search.mjs --json
 */
import { chromium } from "playwright";

import { chromePath } from "./lib/serve-dist.mjs";

/** 默认查询集：覆盖站内五大板块 + 中英文，全部应当返回结果。 */
export const DEFAULT_QUERIES = [
  "ETF",
  "三因子",
  "投资",
  "日报",
  "市场",
  "回测",
  "摄影",
  "宝可梦",
  "徒步",
  "论文",
  "深度学习",
  "复盘",
];

/**
 * 纯逻辑：把每个查询的结果汇总成「有没有坏」。可单测。
 * @param {{ query: string, total?: number, error?: string, retried?: boolean }[]} rows
 */
export function summarizeSearchProbe(rows) {
  const failures = rows.filter((row) => row.error);
  const empties = rows.filter((row) => !row.error && row.total === 0);
  return {
    rows,
    failures,
    empties,
    ok: failures.length === 0,
    /** 失败信息里最有用的是资源路径 + 状态码，提取出来直接给人看 */
    brokenResources: failures.map((row) => extractResource(row.error)),
  };
}

/** 从 pagefind 的报错文本里抽出「状态码 + 资源路径」。 */
export function extractResource(message = "") {
  const match = /(\d{3})\s+fetching\s+(\S+)/.exec(message);
  return match ? { status: Number(match[1]), path: match[2] } : { status: null, path: null };
}

export function formatSearchProbe({ rows, failures, empties, ok }, base) {
  const lines = [`站内搜索探针（${base}）`, ""];
  for (const row of rows) {
    const icon = row.error ? "✗" : row.total === 0 ? "⚠" : "✓";
    const detail = row.error ? `报错：${extractResource(row.error).status ?? "?"} ${extractResource(row.error).path ?? row.error}` : `${row.total} 条`;
    lines.push(`  ${icon} ${row.query} — ${detail}${row.retried ? "（重试后）" : ""}`);
  }
  lines.push("");
  lines.push(
    ok
      ? `搜索可用：${rows.length} 个查询全部返回结果${empties.length ? `（其中 ${empties.length} 个 0 结果，属内容覆盖问题）` : ""}`
      : `搜索坏了：${failures.length}/${rows.length} 个查询报错。碎片 404 = 文件没发布；碎片 403 = 文件在但 nginx 读不了（权限位）`,
  );
  return lines.join("\n");
}

async function probeQuery(page, query) {
  return page.evaluate(async (q) => {
    const pagefind = await import("/pagefind/pagefind.js");
    await pagefind.init();
    const search = await pagefind.search(q);
    // 真正触发碎片下载的是 data()：只 search() 不 data() 测不出 403
    await Promise.all(search.results.slice(0, 3).map((result) => result.data()));
    return search.results.length;
  }, query);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const base = args.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ?? "https://www.zorotreeking.online";
  const queriesArg = args.find((arg) => arg.startsWith("--queries="));
  const queries = queriesArg ? queriesArg.slice("--queries=".length).split(",").filter(Boolean) : DEFAULT_QUERIES;

  const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const rows = [];
  try {
    await page.goto(base, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(500);
    for (const query of queries) {
      let row = { query };
      try {
        row.total = await probeQuery(page, query);
      } catch (error) {
        // 一次报错可能只是某个碎片请求偶发失败，重试一次再定性
        await page.waitForTimeout(800);
        try {
          row = { query, total: await probeQuery(page, query), retried: true };
        } catch (retryError) {
          row.error = String(retryError?.message ?? retryError).split("\n")[0];
        }
      }
      rows.push(row);
    }
  } finally {
    await browser.close();
  }

  const summary = summarizeSearchProbe(rows);
  if (json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else process.stdout.write(`${formatSearchProbe(summary, base)}\n`);

  if (!summary.ok) {
    process.stderr.write(`::error title=站内搜索不可用::${summary.failures.length}/${rows.length} 个查询报错\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
