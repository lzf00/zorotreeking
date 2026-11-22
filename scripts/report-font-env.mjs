#!/usr/bin/env node
/**
 * 报告"这台机器上字体到底落到了谁"（第 149 轮）。
 *
 * 起因：CI 的弱网基线报 `/invest/market/` CLS 0.223 —— 位移详情显示**整页内容上移 24px**，
 * 即首屏上方某块变矮了。最可能的机制是「兜底字体比网页字体宽 → 换行多 → 字体到货后
 * 变窄、少一行」。但本机（macOS）永远落到 Menlo / Arial / Helvetica，量不出来。
 *
 * 这个脚本不做判断，只做"让环境自己说话"：把本机装了哪些候选字体、各自的宽度比、
 * 以及 body 实际命中的字体指纹都打出来。CI 上跑一次就能知道 runner 缺什么。
 *
 * `node scripts/report-font-env.mjs            # 人读
 * `node scripts/report-font-env.mjs --json     # 机器读 / 塞进 notice
 */
import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

const JSON_MODE = process.argv.includes("--json");
const SANS_SAMPLE = "Entries are ordered newest first — the next route is written after the next trip.";
const MONO_SAMPLE = "0123456789 — 1,234.56% +38.4 AAPL SPX";

const SANS_CANDIDATES = ["Arial", "Helvetica", "Liberation Sans", "DejaVu Sans", "Segoe UI", "Roboto", "Noto Sans"];
const MONO_CANDIDATES = ["Menlo", "DejaVu Sans Mono", "Liberation Mono", "Consolas", "Courier New", "SF Mono"];

const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${base}/invest/market/`, { waitUntil: "load" });

const report = await page.evaluate(
  async ({ sansSample, monoSample, sansCandidates, monoCandidates }) => {
    const ctx = document.createElement("canvas").getContext("2d");
    const measure = (family, text) => {
      ctx.font = `100px ${JSON.stringify(family)}`;
      return ctx.measureText(text).width;
    };
    const sentinel = measure("__definitely-not-installed__", sansSample);
    const installed = (family) => Math.abs(measure(family, sansSample) - sentinel) > 0.5;

    await document.fonts.ready;
    const webSans = measure("Inter", sansSample);
    const webMono = measure("JetBrains Mono", monoSample);

    // body 实际命中的字体：拿它的宽度去和候选字体比对，谁最接近就是谁
    const box = document.createElement("span");
    box.textContent = sansSample;
    box.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font-size:100px";
    document.body.appendChild(box);
    const bodyWidth = box.getBoundingClientRect().width;
    box.remove();
    const closest = (width, candidates, text) =>
      ["Inter", ...candidates]
        .map((family) => ({ family, width: measure(family, text) }))
        .map((row) => ({ ...row, delta: Math.abs(row.width - width) }))
        .sort((a, b) => a.delta - b.delta)[0]?.family ?? "?";

    return {
      sans: {
        webWidth: Math.round(webSans),
        bodyWidth: Math.round(bodyWidth),
        resolvedLike: closest(bodyWidth, sansCandidates, sansSample),
        candidates: sansCandidates.map((family) => {
          const ok = installed(family);
          // 没装的字体在 canvas 里会落到默认字体，算出来的比例是假的 —— 直接不给数字
          return { family, installed: ok, ratio: ok ? +(webSans / measure(family, sansSample)).toFixed(3) : null };
        }),
      },
      mono: {
        webWidth: Math.round(webMono),
        resolvedLike: closest(webMono, monoCandidates, monoSample),
        candidates: monoCandidates.map((family) => {
          const ok = installed(family);
          return { family, installed: ok, ratio: ok ? +(webMono / measure(family, monoSample)).toFixed(3) : null };
        }),
      },
    };
  },
  { sansSample: SANS_SAMPLE, monoSample: MONO_SAMPLE, sansCandidates: SANS_CANDIDATES, monoCandidates: MONO_CANDIDATES },
);

await browser.close();
server.close();

if (JSON_MODE) {
  // 一行 JSON：CI 的 notice 只适合放短字符串
  const brief = {
    sans: report.sans.candidates.filter((row) => row.installed).map((row) => `${row.family}@${row.ratio}`),
    mono: report.mono.candidates.filter((row) => row.installed).map((row) => `${row.family}@${row.ratio}`),
    body: report.sans.resolvedLike,
  };
  console.log(JSON.stringify(brief));
} else {
  console.log(`\n无衬线（Inter 宽 ${report.sans.webWidth}px / 正文实测 ${report.sans.bodyWidth}px，最像 ${report.sans.resolvedLike}）`);
  for (const row of report.sans.candidates) {
    console.log(
      `  ${row.installed ? "✓" : "✗"} ${row.family.padEnd(18)} ` +
        (row.installed ? `需要 size-adjust ${(row.ratio * 100).toFixed(1)}%` : "未安装"),
    );
  }
  console.log(`\n等宽（JetBrains Mono 宽 ${report.mono.webWidth}px）`);
  for (const row of report.mono.candidates) {
    console.log(
      `  ${row.installed ? "✓" : "✗"} ${row.family.padEnd(18)} ` +
        (row.installed ? `需要 size-adjust ${(row.ratio * 100).toFixed(1)}%` : "未安装"),
    );
  }
  console.log(`\n（✗ = 这台机器没装。数字是"网页字体宽度 ÷ 该字体宽度"，即该兜底要用的 size-adjust）`);
}
