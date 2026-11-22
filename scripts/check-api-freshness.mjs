#!/usr/bin/env node
/**
 * 线上行情接口的"数据有多旧"（第 165 轮）。
 *
 * 起因：`/api/market/us` 的 BLS 宏观块停在 2026-08-11（103 天）没人发现 ——
 * 页面能拿仓库里的静态快照兜底，所以肉眼看不出来；ETF/指数接口的契约测试只看
 * "字段全不全、能不能算 ratio"，也不看**数据多旧**。
 *
 * 判定只看接口自己带的时间戳，不看 HTTP 状态（状态 200 + 三个月前的数字，才是最危险的）。
 * **永不失败**：陈旧是上游/服务器问题，挡发布只会让内容一起停更（第 159/163 轮同一原则）。
 *
 * 用法：
 *   node scripts/check-api-freshness.mjs --base=https://www.zorotreeking.online
 *   node scripts/check-api-freshness.mjs --base=... --json
 */
const BASE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--base="));
  return arg ? arg.slice("--base=".length).replace(/\/$/, "") : "https://www.zorotreeking.online";
})();
const JSON_OUT = process.argv.includes("--json");
const DAY = 86_400_000;

/**
 * 每个接口里"真正代表数据新鲜度"的字段。
 * 注意不要用顶层的 `ts`：那是**这次响应**的时间，缓存命中时永远是"刚刚"。
 */
export const PROBES = [
  { path: "/api/market/us", label: "美股宏观（BLS）", at: (d) => (d?.macro?.fetched_at ?? NaN) * 1000, maxAgeDays: 7 },
  { path: "/api/market/us", label: "美股行情", at: (d) => (d?.market?.quote_ts ?? NaN) * 1000, maxAgeDays: 5 },
  { path: "/api/market/indices", label: "A 股指数", at: (d) => (d?.ts ?? NaN) * 1000, maxAgeDays: 5 },
  { path: "/api/market/etf", label: "ETF 基准日", at: (d) => Date.parse(`${d?.baseline_date ?? ""}T15:00:00+08:00`), maxAgeDays: 5 },
];

/** 纯判定：一组 {label, ms, maxAgeDays} → 年龄结论。 */
export function ageRows(entries, now = Date.now()) {
  return entries.map(({ label, ms, maxAgeDays }) => {
    const ageDays = Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / DAY)) : null;
    return { label, ageDays, maxAgeDays, stale: ageDays === null || ageDays > maxAgeDays };
  });
}

async function main() {
  const cache = new Map();
  const entries = [];
  for (const probe of PROBES) {
    if (!cache.has(probe.path)) {
      try {
        const response = await fetch(`${BASE}${probe.path}`, { signal: AbortSignal.timeout(20_000) });
        cache.set(probe.path, response.ok ? await response.json() : null);
      } catch {
        cache.set(probe.path, null);
      }
    }
    const payload = cache.get(probe.path);
    entries.push({ label: probe.label, ms: payload ? probe.at(payload) : Number.NaN, maxAgeDays: probe.maxAgeDays });
  }
  const rows = ageRows(entries);
  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, rows }, null, 2));
  } else {
    console.log(`线上行情接口数据年龄（${BASE}）\n`);
    console.log("| 数据 | 距今 | 阈值 | 结论 |");
    console.log("| --- | --- | --- | --- |");
    for (const row of rows) {
      const age = row.ageDays === null ? "读不出来" : `${row.ageDays} 天`;
      console.log(`| ${row.label} | ${age} | ${row.maxAgeDays} 天 | ${row.stale ? "⚠️ 过旧" : "✅"} |`);
    }
  }
  const stale = rows.filter((row) => row.stale);
  if (stale.length) {
    console.log(
      `::warning title=线上行情接口过旧::${stale
        .map((row) => `${row.label}（${row.ageDays === null ? "时间戳读不出来" : `${row.ageDays} 天`}）`)
        .join("；")} —— 页面有静态快照兜底，但这说明服务端抓取链路停了`,
    );
  }
  // 永远 exit 0：这是观测，不是闸门
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
