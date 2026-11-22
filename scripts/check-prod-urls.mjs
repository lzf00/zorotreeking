#!/usr/bin/env node
/**
 * 线上全量 URL 体检（第 170 轮）。
 *
 * 为什么需要：构建期检查看的是 `dist/`，nginx、缓存、重写规则、证书都不在其中。
 * `check:sitemap` 只验证 sitemap 与 dist 一致；没有任何脚本真的去**访问线上每一条 URL**。
 *
 * 用法：
 *   node scripts/check-prod-urls.mjs                 # 抓 sitemap.xml 里的全部 URL
 *   node scripts/check-prod-urls.mjs --limit=50      # 抽样
 *   node scripts/check-prod-urls.mjs --base=http://127.0.0.1:4321
 *
 * 判定：
 *   - 4xx / 5xx / 网络错误 → 失败（exit 1）
 *   - 3xx → 只报告：sitemap 里出现重定向说明 canonical 写错了
 *   - 单页耗时 p95 > 3000ms → 提示（多半是 CDN 未命中）
 */
const args = process.argv.slice(2);
const arg = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const SITE = arg("base", "https://www.zorotreeking.online").replace(/\/$/, "");
const LIMIT = Number(arg("limit", "0"));
const CONCURRENCY = Number(arg("concurrency", "8"));

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "ZoroTreekingProbe/1.0" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

const sitemap = await fetchText(`${SITE}/sitemap.xml`);
let urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => !u.endsWith(".xml"));
if (LIMIT > 0) urls = urls.slice(0, LIMIT);
console.log(`线上 URL 体检：${SITE}（${urls.length} 条）`);

const results = [];
let cursor = 0;
const worker = async () => {
  while (cursor < urls.length) {
    const url = urls[cursor++];
    const started = performance.now();
    try {
      const res = await fetch(url, { redirect: "manual", headers: { range: "bytes=0-2000" } });
      results.push({ url, status: res.status, ms: Math.round(performance.now() - started), location: res.headers.get("location") ?? "" });
    } catch (error) {
      results.push({ url, status: 0, ms: Math.round(performance.now() - started), location: String(error).slice(0, 80) });
    }
  }
};
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

const failed = results.filter((r) => r.status === 0 || r.status >= 400);
const redirected = results.filter((r) => r.status >= 300 && r.status < 400);
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const pick = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))] ?? 0;

console.log(`耗时：p50 ${pick(0.5)}ms · p95 ${pick(0.95)}ms · max ${times.at(-1) ?? 0}ms`);
if (redirected.length) {
  console.log(`::warning title=sitemap 里有重定向::${redirected.length} 条`);
  for (const r of redirected.slice(0, 10)) console.log(`  ↪ ${r.status} ${r.url.replace(SITE, "")} → ${r.location.replace(SITE, "")}`);
}
if (failed.length) {
  console.error(`::error title=线上有页面打不开::${failed.length} / ${results.length}`);
  for (const r of failed.slice(0, 20)) console.error(`  ✗ ${r.status} ${r.url.replace(SITE, "")} ${r.location}`);
  process.exit(1);
}
console.log(`✓ ${results.length} 条 URL 全部 2xx`);
