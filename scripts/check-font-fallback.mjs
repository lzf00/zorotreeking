#!/usr/bin/env node
/**
 * 验证 metric-matched fallback 真的和网页字体等宽。
 *
 * 为什么值得单开一个门禁：`size-adjust` 是个魔法数字，它只在「换字体文件 / 换字号 /
 * 换兜底字体」时才失效，而失效的表现是「某些平台上加载时会抖一下」—— 谁都看不见。
 * 这里在真实浏览器里比较两种状态的渲染宽度：
 *   A. 拦住 woff2（= 用户字体还没到货，用兜底）→ 必须走 "Inter Fallback"
 *   B. 正常加载 → 用 "Inter"
 * 两者宽度差超过 2% 就说明 size-adjust 该重新标定了。
 *
 * 标定工具：`node scripts/calibrate-fallback-metrics.mjs`
 */
import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

const TOLERANCE = 0.02;
const SAMPLE = "Entries are ordered newest first — the next route is written after the next trip.";
const PAIRS = [
  { label: "Inter", stack: '"Inter", "Inter Fallback"', fallback: '"Inter Fallback"' },
  { label: "Instrument Serif", stack: '"Instrument Serif", "Instrument Serif Fallback"', fallback: '"Instrument Serif Fallback"' },
];

const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });

const page = await browser.newPage();
await page.goto(`${base}/en/hike/`, { waitUntil: "load" });

const results = await page.evaluate(async ({ sample, pairs }) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const width = (font) => {
    ctx.font = font;
    return ctx.measureText(sample).width;
  };
  const out = [];
  for (const pair of pairs) {
    await document.fonts.load(`100px ${pair.stack}`, sample);
    const loaded = width(`100px ${pair.stack}`);
    const fallback = width(`100px ${pair.fallback}`);
    out.push({ label: pair.label, loaded, fallback, ratio: fallback / loaded });
  }
  return out;
}, { sample: SAMPLE, pairs: PAIRS });

let failures = 0;
for (const row of results) {
  const delta = Math.abs(row.ratio - 1);
  const ok = delta <= TOLERANCE;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${row.label.padEnd(18)} 兜底/网页宽度 = ${(row.ratio * 100).toFixed(1)}%` +
      `（允许 ±${(TOLERANCE * 100).toFixed(0)}%${ok ? "" : "，需要重新标定 size-adjust"}）`,
  );
}

await browser.close();
server.close();

if (failures > 0) {
  console.error(`\n✗ 字体兜底宽度对不上：${failures}/${results.length} 组。重新跑 node scripts/calibrate-fallback-metrics.mjs 并更新 size-adjust。`);
  process.exit(1);
}
console.log(`\n✓ 兜底字体宽度与网页字体一致（${results.length} 组）`);
