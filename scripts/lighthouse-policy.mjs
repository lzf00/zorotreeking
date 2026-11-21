/**
 * 把 `.lighthouserc.json` 的断言翻译成「这一页到底算不算红」（第 130 轮）。
 *
 * 起因：逐 URL 的 commit status 里，`perf/hike/travel/...` 报 **failure**（71 分），
 * 但同一份报告的 `lhci/url/hike/travel/...` 写的是「Passed with 2 warning(s)」，
 * `perf/audited` 也是 success —— 三条状态互相矛盾。
 *
 * 原因：状态脚本自己硬编码了「perf < 0.80 就 failure」，而 `.lighthouserc.json` 里
 * `categories:performance` 是 **warn**（分数会被 runner 负载带偏，只该告警）。
 * 于是 71 分的页面在 commit 列表上挂了一个红叉，我这一轮就是被这个红叉引过去查了半小时。
 *
 * 现在：判定只读配置里的**error 级**断言，warn 级的只写进描述。
 */
import { readFileSync } from "node:fs";

/** 行数据里能评估的指标 → 配置里的断言 key */
const METRIC_KEYS = {
  lcp: "largest-contentful-paint",
  cls: "cumulative-layout-shift",
  tbt: "total-blocking-time",
  fcp: "first-contentful-paint",
};

const CATEGORY_KEYS = {
  perf: "categories:performance",
  a11y: "categories:accessibility",
  bp: "categories:best-practices",
  seo: "categories:seo",
};

/**
 * 归一化断言表：`{ [key]: { level: "error"|"warn", minScore?, maxNumericValue? } }`
 * LHCI 的写法是 `[level, options]` 或 `level`，两种都吃。
 */
export function normalizeAssertions(assertions = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(assertions)) {
    const [level, options] = Array.isArray(raw) ? raw : [raw, {}];
    const normalized = { level: level === "error" ? "error" : "warn" };
    if (options && typeof options === "object") {
      if (Number.isFinite(options.minScore)) normalized.minScore = options.minScore;
      if (Number.isFinite(options.maxNumericValue)) normalized.maxNumericValue = options.maxNumericValue;
    }
    out[key] = normalized;
  }
  return out;
}

export function loadPolicy(path = new URL("../.lighthouserc.json", import.meta.url)) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  return normalizeAssertions(config?.ci?.assert?.assertions ?? {});
}

/**
 * 评估一页。返回 `{ state, failures, warnings }`：
 * 只有 error 级断言被违反才 failure；warn 级只进 warnings（写进描述，别挂红叉）。
 */
export function evaluateRow(row, policy) {
  const failures = [];
  const warnings = [];
  for (const [field, key] of Object.entries(CATEGORY_KEYS)) {
    const rule = policy[key];
    const value = row[field];
    if (!rule || rule.minScore === undefined || !Number.isFinite(value)) continue;
    if (value < rule.minScore) (rule.level === "error" ? failures : warnings).push(`${key} ${Math.round(value * 100)}<${Math.round(rule.minScore * 100)}`);
  }
  for (const [field, key] of Object.entries(METRIC_KEYS)) {
    const rule = policy[key];
    const value = row[field];
    if (!rule || rule.maxNumericValue === undefined || !Number.isFinite(value)) continue;
    if (value > rule.maxNumericValue) (rule.level === "error" ? failures : warnings).push(`${key} ${Math.round(value)}>${Math.round(rule.maxNumericValue)}`);
  }
  return { state: failures.length ? "failure" : "success", failures, warnings };
}
