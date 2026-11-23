#!/usr/bin/env node
/**
 * 移动端文字可读性自检（Lighthouse `font-size` 审计口径）——第 184 轮。
 *
 * 审计规则很朴素：**小于 12px 的字在手机上要双指放大才能读**，如果一页里
 * ≥12px 的文字不足 60%，Lighthouse 判 `font-size` 失败、SEO 分从 1.0 掉到 0.93。
 *
 * 第 184 轮实测：`/hike/` 只有 48.3%、`/hike/travel/ali-grand-loop-lhasa-return-2026/`
 * 只有 48.3% —— 路线卡片的路由串（占全页 26% 字符）11.5px、路线表里的住宿建议 10.6px。
 * 两处都在移动断点抬到 12px 后变成 95.9% / 93.6%，Lighthouse SEO 回到 1.0。
 *
 * 为什么单独一个脚本：Lighthouse 只在每周一次的 `lighthouse-mobile` 里跑，发现问题
 * 已经晚了七天；这个检查用同一个口径（412×823、按字符数加权）在门禁里跑，10 秒出结果。
 *
 * BASELINE 的语义和 `check:page-weight` / `check:text-zoom` 一致：**只许升不许降**。
 * 抬高了就把数字改大；掉下来就是排版退化。
 *
 * 用法：
 *   node scripts/check-legible-text.mjs
 *   node scripts/check-legible-text.mjs --paths=/hike/,/hike/travel/ali-grand-loop-lhasa-return-2026/
 */
import { chromium } from "playwright";

import { chromePath, serveDist } from "./lib/serve-dist.mjs";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const asJson = args.includes("--json");

/** Lighthouse 的硬底线：≥12px 的文字必须过半再多一点。 */
const HARD_FLOOR = 0.6;
/** 允许的浮动（同一页两次测量差 1–2 个百分点是字体渲染/字体回退造成的）。 */
const TOLERANCE = 0.03;

/** 移动端 412×823 下，≥12px 文字占全部字符的比例。 */
const BASELINE = new Map([
  ["/", 0.83],
  ["/ai/", 0.71],
  ["/ai/digest-2026-06-05/", 0.85],
  ["/about/", 0.8],
  ["/explore/", 0.86],
  ["/photo/", 0.76],
  ["/photo/baokemeng/", 0.9],
  ["/photo/hudieren/", 0.88],
  ["/invest/", 0.8],
  ["/en/", 0.97],
  ["/hike/", 0.95],
  ["/hike/travel/ali-grand-loop-lhasa-return-2026/", 0.93],
  ["/archive/", 0.99],
]);

const PATHS = valueOf("paths", [...BASELINE.keys()].join(",")).split(",").filter(Boolean);

const VIEWPORT = { width: 412, height: 823 };

/** 页面里所有可见文本按字符数加权，算 ≥12px 的占比。 */
const measure = () => {
  let total = 0;
  let legible = 0;
  const worst = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue?.trim() ?? "";
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    if (!el.getBoundingClientRect().width) continue;
    const size = Number.parseFloat(style.fontSize);
    const chars = text.length;
    total += chars;
    if (size >= 12) {
      legible += chars;
      continue;
    }
    const cls = typeof el.className === "string" && el.className.trim() ? el.className.trim().split(/\s+/)[0] : el.tagName;
    worst.set(cls, (worst.get(cls) ?? 0) + chars);
  }
  const offenders = [...worst.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cls, chars]) => `${cls}:${((chars / total) * 100).toFixed(0)}%`);
  return { share: total ? legible / total : 1, total, offenders };
};

const server = await serveDist("dist");
const port = server.address().port;
const browser = await chromium.launch({ executablePath: chromePath() });
const failures = [];
const warnings = [];
const rows = [];

for (const path of PATHS) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    const response = await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
    if (!response || response.status() !== 200) {
      failures.push({ path, reason: `HTTP ${response?.status() ?? "?"}` });
      continue;
    }
    const { share, total, offenders } = await page.evaluate(measure);
    const budget = BASELINE.get(path) ?? HARD_FLOOR;
    rows.push({ path, share, total, offenders });
    if (!total) continue;
    if (share < HARD_FLOOR) {
      failures.push({ path, reason: `${(share * 100).toFixed(1)}% 小于硬底线 ${HARD_FLOOR * 100}%`, offenders });
    } else if (share < Math.min(budget, 1) - TOLERANCE) {
      warnings.push({ path, reason: `${(share * 100).toFixed(1)}% 比基线 ${(budget * 100).toFixed(0)}% 低` });
    }
  } catch (error) {
    failures.push({ path, reason: error instanceof Error ? error.message : String(error) });
  } finally {
    await page.close();
  }
}

await browser.close();
server.close();

if (asJson) {
  console.log(JSON.stringify({ rows, failures, warnings }, null, 2));
} else {
  for (const row of rows) {
    const pct = (row.share * 100).toFixed(1).padStart(5);
    console.log(`${row.share >= HARD_FLOOR ? "✓" : "✗"} ${pct}%  ${row.path}${row.offenders.length ? `  （${row.offenders.join(" ")}）` : ""}`);
  }
}

for (const warning of warnings) console.log(`~ ${warning.path}  ${warning.reason}（不算失败，但说明排版退化了）`);

if (failures.length) {
  console.error(`::error title=移动端可读文字不足::${failures.length} 个页面的 ≥12px 文字不到 ${HARD_FLOOR * 100}%`);
  for (const failure of failures) console.error(`  ✗ ${failure.path}  ${failure.reason}${failure.offenders ? `  ${failure.offenders.join(" ")}` : ""}`);
  process.exit(1);
}

console.log(`\n✓ 移动端文字可读性通过：${rows.length} 个页面 ≥ ${HARD_FLOOR * 100}%（基线只许升不许降）`);
