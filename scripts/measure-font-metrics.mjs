#!/usr/bin/env node
/**
 * 量一下「网页字体」和「系统兜底字体」的宽度差，用来生成 metric-matched fallback。
 *
 * 为什么需要：@font-face 都是 font-display: swap —— 字体没到货前先用系统字体画，
 * 到货后替换。如果两者宽度差得多（Linux 上 Inter 缺省会落到 DejaVu Sans，比 Inter
 * 宽不少），一段文字会从 2 行变成 3 行，整页往下推，这就是 FOUT 布局抖动（第 69 轮
 * 在 CI 上看到 /en/hike/ CLS 0.103，本机同页只有 0.005，差异就在兜底字体的度量）。
 *
 * 解法是给兜底字体也声明一个 @font-face，用 size-adjust 把它缩放到和网页字体等宽：
 *   @font-face { font-family: "Inter Fallback"; src: local("Arial"); size-adjust: 107%; }
 * 这样字体到货前后宽度一致，行数不变，抖动消失，同时保留 swap（不影响 FCP）。
 *
 * 本脚本只负责把数字量出来，结果手写进 src/styles/fonts.css。
 *
 * 用法：node scripts/measure-font-metrics.mjs [--dist=dist]
 */
import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

const args = process.argv.slice(2);
const dist = args.find((a) => a.startsWith("--dist="))?.slice(7) ?? "dist";

const SAMPLES = {
  Inter: "The quick brown fox jumps over the lazy dog — 0123456789 高原公路的清晨与黄昏",
  "Instrument Serif": "The quick brown fox jumps over the lazy dog",
  "JetBrains Mono": "const answer = () => 42; // 0123456789",
};

const FALLBACKS = {
  Inter: ["Arial", "Helvetica", "Liberation Sans", "DejaVu Sans"],
  "Instrument Serif": ["Times New Roman", "Georgia", "Liberation Serif"],
  "JetBrains Mono": ["Courier New", "Liberation Mono", "DejaVu Sans Mono"],
};

const server = await serveDist(dist);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });

const results = await page.evaluate(
  async ({ samples, fallbacks }) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const width = (text, family) => {
      ctx.font = `100px ${JSON.stringify(family)}, monospace`;
      return ctx.measureText(text).width;
    };
    const out = {};
    for (const [family, sample] of Object.entries(samples)) {
      await document.fonts.load(`100px ${JSON.stringify(family)}`, sample);
      const loaded = document.fonts.check(`100px ${JSON.stringify(family)}`, sample);
      const base = width(sample, family);
      out[family] = { loaded, fallbacks: {}, sample: sample.slice(0, 20) };
      for (const fallback of fallbacks[family]) {
        out[family].fallbacks[fallback] = +(base / width(sample, fallback)).toFixed(4);
      }
    }
    return out;
  },
  { samples: SAMPLES, fallbacks: FALLBACKS },
);

for (const [family, data] of Object.entries(results)) {
  console.log(`\n${family}（字体已加载: ${data.loaded}）→ size-adjust 建议：`);
  for (const [fallback, ratio] of Object.entries(data.fallbacks)) {
    console.log(`  ${fallback.padEnd(18)} ${(ratio * 100).toFixed(1)}%`);
  }
}

await browser.close();
server.close();
