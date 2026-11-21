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

/** 预算：中位页面 182 KB，p90 207 KB；HTML 定 220 KB，内联 CSS 定 120 KB */
export const BUDGETS = { htmlBytes: 220 * 1024, cssBytes: 120 * 1024 };

/** 基线页面允许的漂移：超过原值 10% 就要求重新登记理由 */
export const DRIFT_RATIO = 0.1;

export function parseStyleBytes(html) {
  let total = 0;
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) total += match[1].length;
  return total;
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
    if (!allowed) {
      if (page.htmlBytes > budgets.htmlBytes) {
        failures.push({ path: page.path, kind: "html", actual: page.htmlBytes, limit: budgets.htmlBytes, message: `新页面 HTML ${kb(page.htmlBytes)} 超过预算 ${kb(budgets.htmlBytes)}` });
      }
      if (page.cssBytes > budgets.cssBytes) {
        failures.push({ path: page.path, kind: "css", actual: page.cssBytes, limit: budgets.cssBytes, message: `新页面内联 CSS ${kb(page.cssBytes)} 超过预算 ${kb(budgets.cssBytes)}` });
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
    if (page.htmlBytes > allowed.htmlBytes) warnings.push(`${page.path} 比基线重了 ${kb(page.htmlBytes - allowed.htmlBytes)}`);
  }
  // 基线里登记了但页面已经不存在的项：不是错误，但说明基线该清理
  const seen = new Set(pages.map((p) => p.path));
  for (const path of Object.keys(baseline)) if (!seen.has(path)) warnings.push(`基线里的 ${path} 已不存在，可以删掉`);

  const heaviest = [...pages].sort((a, b) => b.htmlBytes - a.htmlBytes).slice(0, 5);
  return { failures, warnings, heaviest };
}

export function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}
