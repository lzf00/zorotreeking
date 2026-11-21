#!/usr/bin/env node
/**
 * 站外链接体检（第 132 轮）。
 *
 * `node scripts/check-external-links.mjs                # 全量（默认并发 12，约 8–12 分钟）
 * `node scripts/check-external-links.mjs --limit 200    # 抽样
 * `node scripts/check-external-links.mjs --hosts arxiv.org,openai.com
 * `node scripts/check-external-links.mjs --json`
 * `node scripts/check-external-links.mjs --report-only  # 永远退出 0（周巡检用）
 *
 * 结果缓存在 `.cache/external-links.json`（7 天），所以第二次跑会快很多。
 * 判定规则见 scripts/lib/external-links.mjs。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { classify, hostOf, isBotBlockingHost, summarize, BOT_BLOCKING_HOSTS } from "./lib/external-links.mjs";

const CACHE = ".cache/external-links.json";
const BASELINE = "scripts/external-links-baseline.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 9000;

function parseArgs(argv) {
  const args = { limit: Infinity, hosts: null, concurrency: 12, json: false, reportOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") args.limit = Number(argv[++i]) || Infinity;
    else if (arg === "--hosts") args.hosts = String(argv[++i] || "").split(",").filter(Boolean);
    else if (arg === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 12);
    else if (arg === "--json") args.json = true;
    else if (arg === "--report-only") args.reportOnly = true;
  }
  return args;
}

function collectUrls(dir, out = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectUrls(path, out);
    else if (entry.name === "index.html") {
      const html = readFileSync(path, "utf8");
      // 只收正文里的 `<a href>`：`<link rel="preconnect" href="https://fonts.googleapis.com">`
      // 这类资源提示会把"根路径 404 的 CDN 源站"算成死链（第 132 轮实测踩到）。
      for (const match of html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"#]+)"/g)) {
        const url = match[1];
        if (url.includes("zorotreeking.online")) continue;
        out.add(url.split("#")[0]);
      }
    }
  }
  return out;
}

async function probe(url) {
  const attempt = async (method) => {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: { "user-agent": "ZoroTreekingLinkCheck/1.0 (+https://www.zorotreeking.online/about/)", accept: "text/html,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status };
  };
  try {
    // 有些站不认 HEAD，退回 GET（只取首字节）
    const head = await attempt("HEAD");
    if (head.status === 405 || head.status === 403 || head.status === 501) return await attempt("GET");
    return head;
  } catch (error) {
    return { status: 0, error: error?.name === "TimeoutError" ? "timeout" : String(error?.cause?.code ?? error?.message ?? error) };
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const args = parseArgs(process.argv.slice(2));
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

let urls = [...collectUrls("dist")].sort();
if (args.hosts) urls = urls.filter((url) => args.hosts.includes(hostOf(url)) || args.hosts.some((h) => url.includes(h)));
urls = urls.slice(0, args.limit);

const now = Date.now();
const results = [];
const toFetch = [];
for (const url of urls) {
  const cached = cache[url];
  if (cached && now - cached.at < CACHE_TTL_MS) {
    results.push({ url, status: cached.status, error: cached.error, verdict: cached.verdict });
    continue;
  }
  toFetch.push(url);
}

process.stderr.write(`外链 ${urls.length} 条 · 缓存命中 ${results.length} · 待抓 ${toFetch.length}\n`);
let done = 0;
const fetched = await mapWithConcurrency(toFetch, args.concurrency, async (url) => {
  const blocking = isBotBlockingHost(url);
  const outcome = blocking ? { status: 0 } : await probe(url);
  const verdict = classify({ ...outcome, url });
  done += 1;
  if (done % 100 === 0) process.stderr.write(`  已抓 ${done}/${toFetch.length}\n`);
  return { url, status: outcome.status, error: outcome.error, verdict, at: Date.now() };
});

for (const row of fetched) cache[row.url] = { status: row.status, error: row.error, verdict: row.verdict, at: row.at };
mkdirSync(dirname(CACHE), { recursive: true });
writeFileSync(CACHE, JSON.stringify(cache));
results.push(...fetched.map(({ url, status, error, verdict }) => ({ url, status, error, verdict })));

const report = summarize(results, { baseline });
const exitWithProblems = (report.dead.length > 0 || report.suspect.length > 0) && !args.reportOnly;

if (args.json) {
  console.log(JSON.stringify({ ...report, total: urls.length }, null, 2));
} else {
  console.log(`外链体检：${urls.length} 条（本次检查 ${report.checked}）`);
  console.log(`  正常 ${report.counts.ok} · 死链 ${report.counts.dead} · 反爬 ${report.counts.blocked} · 可疑 ${report.counts.suspect} · 服务器/超时 ${report.counts.error} · 基线跳过 ${report.counts.skipped}`);
  if (report.byHost.length) {
    console.log("  死链按域名：");
    for (const [host, count] of report.byHost.slice(0, 8)) console.log(`    ${String(count).padStart(4)}  ${host}`);
  }
  for (const row of report.dead.slice(0, 10)) console.log(`  ❌ ${row.status}  ${row.url.slice(0, 110)}`);
  for (const row of report.suspect.slice(0, 5)) console.log(`  ⚠️  ${row.status}  ${row.url.slice(0, 110)}`);
  if (!report.dead.length) console.log("✅ 没有死链");
}
process.exit(exitWithProblems ? 1 : 0);
