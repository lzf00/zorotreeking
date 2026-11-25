/**
 * 页面重量看门狗的核心逻辑（第 131 轮）。
 *
 * 起因：`/hike/travel/...` 的 LCP 在 CI 里 1.19 s ↔ 2.66 s 之间跳。查下去发现该页
 * HTML **309 KB**，中位数页面是 182 KB——慢网下光传输就 1.5 s，LCP 自然跟着抖。
 * 全站 1198 个页面里 242 个超过 200 KB，最重的 `/invest/digest/` 429 KB。
 *
 * 这类问题不会报错、不会 404、跑门禁也不会红，只会悄悄变重。所以补一条闸门：
 * 超过预算就红，已有超标的页面进基线（附理由），基线页面**再长 10% 也要重新审**。
 */

/**
 * 预算（第 134 轮把"传输成本"和"解析成本"分开量了）：
 * - `htmlBytes` 220 KB：解析/DOM 构建的成本，中位页面 182 KB、p90 207 KB
 * - `gzipBytes` 60 KB：真正过网的字节，全站中位 **37 KB**、p90 41 KB、
 *   只有 8 个阿里路线页 67–79 KB（页面自带 48 KB 地图样式，压不动）
 * - `tags` 3000：DOM 节点数的近似，中位 559、p99 1695、最大 2011
 *
 * 为什么三个都要：`/archive/` 347 KB raw 但只有 32 KB gzip —— 只盯 raw 会误判它"重"，
 * 只盯 gzip 又会漏掉 532 行 × 5 个节点的解析成本。分开量才知道该优化哪一头。
 */
export const BUDGETS = { htmlBytes: 220 * 1024, cssBytes: 120 * 1024, gzipBytes: 60 * 1024, tags: 3000 };

/** 基线页面允许的漂移：超过原值 10% 就要求重新登记理由 */
export const DRIFT_RATIO = 0.1;

export function parseStyleBytes(html) {
  let total = 0;
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) total += match[1].length;
  return total;
}

/** DOM 节点数的便宜近似：开始标签个数。真要精确得上解析器，闸门不需要那个精度。 */
export function countTags(html) {
  return (html.match(/<[a-z][a-z0-9]*/g) ?? []).length;
}

/**
 * @param {Array<{path: string, htmlBytes: number, cssBytes: number}>} pages
 * @param {Record<string, {htmlBytes: number, cssBytes: number, reason: string}>} baseline
 * @returns {{ failures: Array<{path: string, kind: string, actual: number, limit: number, message: string}>, warnings: string[], heaviest: Array<{path: string, htmlBytes: number}> }}
 */
export function evaluatePages(pages, baseline = {}, budgets = BUDGETS) {
  const failures = [];
  const warnings = [];
  for (const page of pages) {
    const allowed = baseline[page.path];
    const gzip = Number.isFinite(page.gzipBytes) ? page.gzipBytes : null;
    const tags = Number.isFinite(page.tags) ? page.tags : null;
    if (!allowed) {
      if (page.htmlBytes > budgets.htmlBytes) {
        failures.push({ path: page.path, kind: "html", actual: page.htmlBytes, limit: budgets.htmlBytes, message: `新页面 HTML ${kb(page.htmlBytes)} 超过预算 ${kb(budgets.htmlBytes)}` });
      }
      if (page.cssBytes > budgets.cssBytes) {
        failures.push({ path: page.path, kind: "css", actual: page.cssBytes, limit: budgets.cssBytes, message: `新页面内联 CSS ${kb(page.cssBytes)} 超过预算 ${kb(budgets.cssBytes)}` });
      }
      if (gzip !== null && gzip > budgets.gzipBytes) {
        failures.push({ path: page.path, kind: "gzip", actual: gzip, limit: budgets.gzipBytes, message: `新页面 gzip 后 ${kb(gzip)} 超过预算 ${kb(budgets.gzipBytes)}` });
      }
      if (tags !== null && tags > budgets.tags) {
        failures.push({ path: page.path, kind: "tags", actual: tags, limit: budgets.tags, message: `新页面 ${tags} 个标签超过预算 ${budgets.tags}` });
      }
      continue;
    }
    // 基线页面：只关心"又变重了"
    const htmlLimit = Math.max(budgets.htmlBytes, Math.round(allowed.htmlBytes * (1 + DRIFT_RATIO)));
    if (page.htmlBytes > htmlLimit) {
      failures.push({ path: page.path, kind: "html-drift", actual: page.htmlBytes, limit: htmlLimit, message: `基线 ${kb(allowed.htmlBytes)} → 现在 ${kb(page.htmlBytes)}，超出 10% 漂移上限（理由：${allowed.reason}）` });
    }
    const cssLimit = Math.max(budgets.cssBytes, Math.round((allowed.cssBytes ?? 0) * (1 + DRIFT_RATIO)));
    if (page.cssBytes > cssLimit) {
      failures.push({ path: page.path, kind: "css-drift", actual: page.cssBytes, limit: cssLimit, message: `内联 CSS ${kb(page.cssBytes)} 超过 ${kb(cssLimit)}（基线 ${kb(allowed.cssBytes ?? 0)}）` });
    }
    const gzipLimit = Math.max(budgets.gzipBytes, Math.round((allowed.gzipBytes ?? 0) * (1 + DRIFT_RATIO)));
    if (gzip !== null && gzip > gzipLimit) {
      failures.push({ path: page.path, kind: "gzip-drift", actual: gzip, limit: gzipLimit, message: `gzip ${kb(gzip)} 超过 ${kb(gzipLimit)}（基线 ${kb(allowed.gzipBytes ?? 0)}；理由：${allowed.reason}）` });
    }
    const tagLimit = Math.max(budgets.tags, Math.round((allowed.tags ?? 0) * (1 + DRIFT_RATIO)));
    if (tags !== null && tags > tagLimit) {
      failures.push({ path: page.path, kind: "tags-drift", actual: tags, limit: tagLimit, message: `${tags} 个标签超过 ${tagLimit}（基线 ${allowed.tags ?? 0}）` });
    }
    if (page.htmlBytes > allowed.htmlBytes) warnings.push(`${page.path} 比基线重了 ${kb(page.htmlBytes - allowed.htmlBytes)}`);
  }
  // 基线里登记了但页面已经不存在的项：不是错误，但说明基线该清理
  const seen = new Set(pages.map((p) => p.path));
  for (const path of Object.keys(baseline)) if (!seen.has(path)) warnings.push(`基线里的 ${path} 已不存在，可以删掉`);

  const heaviest = [...pages].sort((a, b) => b.htmlBytes - a.htmlBytes).slice(0, 5);
  const heaviestByGzip = [...pages].filter((page) => Number.isFinite(page.gzipBytes)).sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 5);
  return { failures, warnings, heaviest, heaviestByGzip };
}

export function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}
