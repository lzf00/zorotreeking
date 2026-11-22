/**
 * 把 `audit-site.mjs` 产出的 JSONL 汇总成可比较的数字（第 158 轮）。
 *
 * 为什么要它：全量巡检每周跑一次，但**只打印**，没人能看出"站点在慢慢变重"。
 * 逐页粗看没变化，中位数三个月涨 40% 这种事只有在有基线时才会显形。
 * 这里只做纯计算，便于单元测试（不碰文件系统、不碰浏览器）。
 */

/** @typedef {{url: string, status?: number, bytes: number, requests?: number}} AuditRow */

/** 分位数：线性插值，和大多数量化口径一致。 */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

/**
 * @param {AuditRow[]} rows
 * @returns {{pages: number, failed: number, medianKB: number, p95KB: number, heaviest: {url: string, kb: number}[]}}
 */
export function summarize(rows) {
  const ok = rows.filter((r) => (r.status ?? 200) >= 200 && (r.status ?? 200) < 300);
  const bytes = ok.map((r) => r.bytes ?? 0);
  const heaviest = [...ok]
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
    .slice(0, 5)
    .map((r) => ({ url: r.url, kb: r.bytes ?? 0 }));
  return {
    pages: rows.length,
    failed: rows.length - ok.length,
    medianKB: Math.round(percentile(bytes, 0.5) * 10) / 10,
    p95KB: Math.round(percentile(bytes, 0.95) * 10) / 10,
    heaviest,
  };
}

/**
 * 和基线比：只报"明显变重"（p95 涨超 15%）和"出现失败页"。
 * 变轻不算问题，但会照常写进报告，方便看出优化是否生效。
 * @param {ReturnType<typeof summarize>} now
 * @param {{medianKB?: number, p95KB?: number} | null} baseline
 */
export function compare(now, baseline, { growthTolerance = 1.15 } = {}) {
  const problems = [];
  if (now.failed > 0) problems.push(`${now.failed} 页加载失败`);
  if (baseline?.p95KB) {
    const ratio = now.p95KB / baseline.p95KB;
    if (ratio > growthTolerance) {
      problems.push(`p95 下载量 ${baseline.p95KB}→${now.p95KB} KB（+${Math.round((ratio - 1) * 100)}%）`);
    }
  }
  return { problems, ok: problems.length === 0 };
}

/** 从 JSONL 文本读行（忽略空行与坏行）。 */
export function parseJsonl(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      /* 半行/坏行忽略：巡检中途被杀时最后一行常常不完整 */
    }
  }
  return rows;
}
