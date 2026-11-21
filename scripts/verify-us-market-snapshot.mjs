/**
 * 发布前的行情快照完整性闸门（第 146 轮）。
 *
 * 为什么需要：`deploy.yml` 会在快照过旧时自动重抓（第 146 轮加的自愈步骤），
 * 但抓取脚本"成功退出"不等于"内容可用" —— 接口可能只回了一半（部分指数缺失）、
 * 或者宏观接口挂了留下 `stale: true`。这种文件一旦发出去，页面上的数字会一半新一半旧，
 * 而且没有任何报错。
 *
 * 所以自愈步骤提交前必须过这道闸：不合格就回滚，保持原来那份（旧但完整）。
 *
 * 用法：
 *   node scripts/verify-us-market-snapshot.mjs [file]   # 默认 src/data/us-market-latest.json
 */
import { readFile } from "node:fs/promises";

const DEFAULT_FILE = "src/data/us-market-latest.json";

/** 纯函数：给一份快照数据，判断它能不能发布。返回 { ok, problems }。 */
export function verifySnapshot(data) {
  const problems = [];
  if (!data || typeof data !== "object") return { ok: false, problems: ["不是对象"] };

  if (data.ok !== true) problems.push(`ok 不是 true（${JSON.stringify(data.ok)}）`);
  if (data.stale === true) problems.push("整份快照被标记为 stale（抓取不完整）");

  const macro = data.macro;
  if (!macro || typeof macro !== "object") {
    problems.push("缺少 macro 段");
  } else {
    if (!Number.isFinite(macro.fetched_at)) problems.push("macro.fetched_at 缺失");
    if (macro.stale === true) problems.push("宏观数据被标记为 stale");
    for (const key of ["cpi", "core_cpi"]) {
      const point = macro[key];
      if (!point || typeof point !== "object") problems.push(`缺少 macro.${key}`);
      else if (!Number.isFinite(point.actual)) problems.push(`macro.${key}.actual 不是数字`);
      else if (typeof point.reference !== "string" || !/^\d{4}-\d{2}$/.test(point.reference))
        problems.push(`macro.${key}.reference 不是 YYYY-MM（${JSON.stringify(point.reference)}）`);
    }
  }

  const market = data.market;
  if (!market || typeof market !== "object") {
    problems.push("缺少 market 段");
  } else {
    if (!Number.isFinite(market.quote_ts)) problems.push("market.quote_ts 缺失");
    if (!Array.isArray(market.indices) || market.indices.length === 0) problems.push("market.indices 为空");
    else {
      const quotes = market.indices.filter((row) => Number.isFinite(row?.price));
      if (quotes.length === 0) problems.push("market.indices 里没有一条带 price");
    }
    if (Number.isFinite(market.requested) && Number.isFinite(market.succeeded) && market.succeeded < 1)
      problems.push(`market.succeeded 为 ${market.succeeded}（一条都没抓到）`);
  }

  return { ok: problems.length === 0, problems };
}

async function main() {
  const file = process.argv[2] || DEFAULT_FILE;
  const data = JSON.parse(await readFile(file, "utf8"));
  const { ok, problems } = verifySnapshot(data);
  if (!ok) {
    console.error(`✗ ${file} 不能发布：\n${problems.map((item) => `  · ${item}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`✓ ${file} 可以发布（宏观 ${data.macro.cpi.reference}，行情 ${data.market.indices.length} 条指数）`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
