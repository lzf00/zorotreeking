#!/usr/bin/env node
/**
 * 量「网页字体」与「本机兜底字体」的宽度比，输出 @font-face 需要的 size-adjust。
 *
 * 背景：`font-display: swap` 会先用系统字体画、字体到货再替换。若两者宽度差得多，
 * 一段文字从 2 行变 3 行，整页往下推 —— 第 69 轮在 CI 上量到 `/en/hike/` CLS 0.103
 * （本机 macOS 只有 0.005），机制用「兜底换成宽字体」的对照实验验证过：0.005 → 0.233，
 * 加 metric-matched fallback 后回到 0.006。
 *
 * 本脚本只做标定：把数字抄进 src/styles/fonts.css 的 `size-adjust`。
 * 本机没有的字体（Linux 的 DejaVu、Android 的 Roboto）会明确标注「未安装，需在该平台标定」。
 *
 * 用法：node scripts/calibrate-fallback-metrics.mjs
 */
import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

const SAMPLE = "Entries are ordered newest first — the next route is written after the next trip. Longer multi-day drives are kept as standalone guide pages, because they need day-by-day itineraries.";

const TARGETS = [
  { webfont: "Inter", candidates: ["Arial", "Helvetica", "Liberation Sans", "Segoe UI", "Roboto", "DejaVu Sans"] },
  { webfont: "Instrument Serif", candidates: ["Times New Roman", "Georgia", "Liberation Serif", "DejaVu Serif"] },
];

const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(`${base}/en/hike/`, { waitUntil: "load" });

const result = await page.evaluate(async ({ sample, targets }) => {
  const ctx = document.createElement("canvas").getContext("2d");
  const width = (family) => {
    ctx.font = `100px ${JSON.stringify(family)}`;
    return ctx.measureText(sample).width;
  };
  // 不存在的字体在 canvas 里会落到默认字体；用它当哨兵判断「这个字体装了没」
  const sentinel = width("__definitely-not-installed__");
  const out = [];
  for (const { webfont, candidates } of targets) {
    await document.fonts.load(`100px ${JSON.stringify(webfont)}`, sample);
    const webWidth = width(webfont);
    for (const family of candidates) {
      const width_ = width(family);
      const installed = Math.abs(width_ - sentinel) > 0.5;
      out.push({ webfont, family, installed, sizeAdjust: +(webWidth / width_).toFixed(4) });
    }
  }
  return out;
}, { sample: SAMPLE, targets: TARGETS });

for (const target of TARGETS) {
  console.log(`\n${target.webfont} → 兜底字体`);
  for (const row of result.filter((r) => r.webfont === target.webfont)) {
    if (!row.installed) {
      console.log(`  ${row.family.padEnd(18)} 未安装（需要在对应平台上量）`);
      continue;
    }
    console.log(`  ${row.family.padEnd(18)} size-adjust: ${(row.sizeAdjust * 100).toFixed(1)}%`);
  }
}

await browser.close();
server.close();
