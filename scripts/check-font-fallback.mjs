#!/usr/bin/env node
/**
 * 验证 metric-matched fallback 真的和网页字体等宽。
 *
 * 为什么值得单开一个门禁：`size-adjust` 是个魔法数字，它只在「换字体文件 / 换字号 /
 * 换兜底字体」时才失效，而失效的表现是「某些平台上加载时会抖一下」—— 谁都看不见。
 * 这里在真实浏览器里比较两种状态的渲染宽度：
 *   A. 拦住 woff2（= 用户字体还没到货，用兜底）→ 必须走 "Inter Fallback"
 *   B. 正常加载 → 用 "Inter"
 * 两者**宽度**和**行盒高度**（ascent+descent）都要对齐：
 *  - 宽度不对 → 换行行数变，整页位移；
 *  - 行盒高度不对 → 大标题换字体的瞬间整块高度变，同样整页位移（第 72 轮 /invest/digest 页 0.072）。
 * 任一超过 2% 就说明 size-adjust / ascent-override 该重新标定了。
 *
 * 标定工具：`node scripts/calibrate-fallback-metrics.mjs`
 */
import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

const TOLERANCE = 0.02;
const SAMPLE = "Entries are ordered newest first — the next route is written after the next trip.";
const PAIRS = [
  { label: "Inter", stack: '"Inter"', fallback: '"Inter Fallback"' },
  { label: "Instrument Serif", stack: '"Instrument Serif"', fallback: '"Instrument Serif Fallback"' },
];

const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });

const page = await browser.newPage();
await page.goto(`${base}/en/hike/`, { waitUntil: "load" });

const results = await page.evaluate(async ({ sample, pairs }) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const metrics = (stack) => {
    ctx.font = `100px ${stack}`;
    const m = ctx.measureText(sample);
    return { width: m.width, lineBox: (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 100 };
  };
  const out = [];
  for (const pair of pairs) {
    await document.fonts.load(`100px ${pair.stack}`, sample);
    await document.fonts.load(`100px ${pair.fallback}`, sample);
    const web = metrics(pair.stack);
    const fallback = metrics(pair.fallback);
    out.push({ label: pair.label, web, fallback, ratio: fallback.width / web.width, lineRatio: fallback.lineBox / web.lineBox });
  }
  return out;
}, { sample: SAMPLE, pairs: PAIRS });

let failures = 0;
for (const row of results) {
  const widthOk = Math.abs(row.ratio - 1) <= TOLERANCE;
  // 行盒高度（ascent+descent）必须也对齐：只对宽度不够，大标题换字体时整块会跳
  const boxOk = Math.abs(row.lineRatio - 1) <= TOLERANCE;
  if (!widthOk || !boxOk) failures += 1;
  const mark = widthOk && boxOk ? "✓" : "✗";
  console.log(
    `${mark} ${row.label.padEnd(18)} 宽度 ${(row.ratio * 100).toFixed(1)}% · 行盒高度 ${(row.lineRatio * 100).toFixed(1)}%` +
      `（允许 ±${(TOLERANCE * 100).toFixed(0)}%${widthOk && boxOk ? "" : "，需要重新标定 size-adjust / ascent-override"}）`,
  );
}

await browser.close();
server.close();

if (failures > 0) {
  console.error(
    `\n✗ 字体兜底对不上：${failures}/${results.length} 组（宽度或行盒高度）。` +
      `重新跑 node scripts/calibrate-fallback-metrics.mjs，把 size-adjust / ascent-override / descent-override 一起更新。`,
  );
  process.exit(1);
}
console.log(`\n✓ 兜底字体宽度与网页字体一致（${results.length} 组）`);
