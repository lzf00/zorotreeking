#!/usr/bin/env node
/**
 * 200% 文字缩放自检（WCAG 1.4.4 Resize text）——第 173 轮。
 *
 * 手机默认字号调大、或系统「大字体」开启后，rem 基准会从 16px 变成 24–32px ——
 * 相当于文字放大 150–200%，而**媒体查询的断点不变**。这时最容易出问题的是那些
 * `h-14` + `justify-between` 的一行式布局：内容放不下就横向溢出，右侧按钮被推出屏幕。
 *
 * 第 173 轮：12 个模板里 11 个溢出（最多 182px），修到 10 个清零。
 * 第 174 轮：剩下 2 个也清零 —— `/en/` 是英文大标题不断词（145px），
 * `/invest/` 是大数字撑破卡片（52px）。现在 **12 个模板全部 0**。
 *
 * 阈值策略和 `check:page-weight` 一致：BASELINE 记录当前值，**只许降不许升**。
 * 修好一个就把数字改小，全清零时删掉那一行。
 *
 * 用法：
 *   node scripts/check-text-zoom.mjs
 *   node scripts/check-text-zoom.mjs --paths=/en/,/invest/
 */
import { chromium } from "playwright";

import { chromePath, serveDist } from "./lib/serve-dist.mjs";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

/** 200% 文字下允许的横向溢出（px）。0 表示必须完全不溢出。 */
const BASELINE = new Map([
  ["/", 0],
  ["/ai/", 0],
  ["/ai/digest-2026-11-22/", 0],
  ["/invest/", 0],
  ["/invest/us-market/", 0],
  ["/invest/etf/", 0],
  ["/photo/", 0],
  ["/photo/baokemeng/", 0],
  ["/hike/", 0],
  ["/guestbook/", 0],
  ["/en/", 0],
  ["/en/ai/digest-2026-11-22/", 0],
]);

const PATHS = valueOf("paths", [...BASELINE.keys()].join(",")).split(",").filter(Boolean);
const ROOT_FONT_PX = Number(valueOf("font", "32"));

const server = await serveDist(new URL("../dist", import.meta.url).pathname);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath() });
const failures = [];

try {
  for (const path of PATHS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await page.goto(base + path, { waitUntil: "load", timeout: 60_000 });
      const overflow = await page.evaluate((rootFontPx) => {
        document.documentElement.style.fontSize = `${rootFontPx}px`;
        const doc = document.documentElement;
        // 等一帧，让 rem 变化后的布局落定
        return new Promise((resolve) => requestAnimationFrame(() => resolve(Math.round(doc.scrollWidth - doc.clientWidth))));
      }, ROOT_FONT_PX);

      const budget = BASELINE.get(path) ?? 0;
      if (overflow > budget) {
        console.log(`✗ ${path}  文字 ${ROOT_FONT_PX / 16 * 100}% 横向溢出 ${overflow}px（预算 ${budget}px）`);
        failures.push({ path, overflow, budget });
      } else if (overflow > 0) {
        console.log(`~ ${path}  溢出 ${overflow}px（预算 ${budget}px，已有债务）`);
      } else {
        console.log(`✓ ${path}  不溢出`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`::error title=文字放大后横向溢出::${failures.length} 个页面超出预算`);
  process.exit(1);
}
console.log(`\n✓ 200% 文字缩放自检通过：${PATHS.length} 个模板（预算只许降不许升）`);
