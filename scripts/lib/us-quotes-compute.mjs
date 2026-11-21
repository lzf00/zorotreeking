/**
 * 东方财富公开延迟行情 → `/invest/us-market/` 的行情块（第 137 轮）。
 *
 * 上一轮修好了宏观块（BLS），行情块还停在 2026-08-11——因为采集也不在这个仓库里。
 * 实测东方财富的公开接口可用，且三类标的的市场前缀不同：
 *
 * | 类型 | secid 前缀 | 例子 |
 * |---|---|---|
 * | 美股指数 | `100.` | `100.SPX`、`100.NDX`、`100.DJIA` |
 * | 美股 ETF | `107.` | `107.XLK`、`107.IWM`（`105.` 会返回 null） |
 * | 美股个股 | `105.` | `105.AAPL`、`105.MSFT` |
 *
 * 字段（`stock/get?fields=f43,f57,f59,f60,f86,f169,f170`）：
 * `f43` 最新价、`f59` 小数位数、`f60` 昨收、`f169` 涨跌额、`f170` 涨跌幅（×100）、
 * `f86` 行情时间戳（秒）。价格类字段都要除以 `10^f59`，不同标的位数不同（指数 2 位、个股 3 位）。
 *
 * 这里只做纯计算，网络在 `scripts/fetch-us-quotes.mjs`。
 */

/**
 * 代码 → 候选 secid（按顺序尝试）。
 *
 * 为什么需要候选：页面把 Robinhood 的 IWM 放在"指数"组里，但它是 **ETF**，
 * 用 `100.IWM` 查东方财富返回 null，必须落到 `107.IWM`。这类"分组是版式、不是资产类别"
 * 的情况不写死映射，而是给指数/ETF 各两个前缀依次试。
 * 个股 `105.` 只此一个前缀（107/100 对个股都返回 null）。
 */
export function secidCandidates(symbol, kind) {
  if (kind === "stock") return [`105.${symbol}`];
  const order = kind === "index" ? ["100", "107"] : ["107", "100"];
  return order.map((prefix) => `${prefix}.${symbol}`);
}

/** 兼容旧调用：取第一个候选。 */
export function secidFor(symbol, kind) {
  return secidCandidates(symbol, kind)[0];
}

/** 单只标的的原始响应 → 展示用报价；数据不可用时返回 null（由调用方保留旧值）。 */
export function parseQuote(symbol, raw) {
  const data = raw?.data;
  if (!data) return null;
  const decimals = Number.isFinite(Number(data.f59)) ? Number(data.f59) : 2;
  const scale = 10 ** decimals;
  const price = Number(data.f43) / scale;
  if (!Number.isFinite(price) || price <= 0) return null;
  const change = Number(data.f169) / scale;
  const changePct = Number(data.f170) / 100;
  const quoteTs = Number(data.f86);
  return {
    symbol,
    price: Math.round(price * 1000) / 1000,
    change: Number.isFinite(change) ? Math.round(change * 1000) / 1000 : null,
    change_pct: Number.isFinite(changePct) ? Math.round(changePct * 100) / 100 : null,
    quote_ts: Number.isFinite(quoteTs) && quoteTs > 0 ? quoteTs : null,
  };
}

const groupSpec = {
  indices: "index",
  sectors: "etf",
  companies: "stock",
};

/**
 * @param {Record<string, {symbol: string, name: string}[]>} previous 现有 JSON 的三组条目（保留中文名与顺序）
 * @param {Record<string, Record<string, any>>} rawByGroup 形如 { indices: { SPX: payload } }
 * @param {{ now: number }} options now = 秒级时间戳
 */
export function buildMarketBlocks(previous, rawByGroup, { now }) {
  const blocks = {};
  let requested = 0;
  let succeeded = 0;
  const problems = [];
  for (const [group, kind] of Object.entries(groupSpec)) {
    const rows = [];
    for (const item of previous?.[group] ?? []) {
      requested += 1;
      const parsed = parseQuote(item.symbol, rawByGroup?.[group]?.[item.symbol]);
      if (parsed) {
        succeeded += 1;
        rows.push({ ...parsed, name: item.name });
      } else {
        // 抓不到就保留上一次的值并记录，页面会显示"覆盖 N/M"
        problems.push(`${kind}:${item.symbol}`);
        rows.push({ ...item });
      }
    }
    blocks[group] = rows;
  }
  const quoteTimestamps = Object.values(blocks)
    .flat()
    .map((row) => row.quote_ts)
    .filter((ts) => Number.isFinite(ts) && ts > 0);
  const quoteTs = quoteTimestamps.length > 0 ? Math.max(...quoteTimestamps) : now;
  return {
    indices: blocks.indices,
    sectors: blocks.sectors,
    companies: blocks.companies,
    requested,
    succeeded,
    partial: succeeded < requested,
    stale: false,
    quote_ts: quoteTs,
    problems,
  };
}
