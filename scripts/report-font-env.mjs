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
// 衬线是第 149 轮漏掉的一组：站点标题用 Instrument Serif，兜底按 Times New Roman 标定（84.3%）。
// 若 runner 上没有 Times/Georgia/Liberation Serif，它会落到宽得多的 DejaVu Serif。
const SERIF_CANDIDATES = ["Times New Roman", "Georgia", "Liberation Serif", "DejaVu Serif", "Songti SC"];
const SERIF_SAMPLE = "Market depth — the next route is written after the next trip";
/** 布局对比：同一页「只用兜底」与「用网页字体」两种状态下，谁都高度变了。 */
const LAYOUT_DIFF = process.argv.includes("--layout-diff");

const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${base}/invest/market/`, { waitUntil: "load" });

const report = await page.evaluate(
  async ({ sansSample, monoSample, sansCandidates, monoCandidates, serifSample, serifCandidates }) => {
    const ctx = document.createElement("canvas").getContext("2d");
    const measure = (family, text) => {
      ctx.font = `100px ${JSON.stringify(family)}`;
      return ctx.measureText(text).width;
    };
    const sentinel = measure("__definitely-not-installed__", sansSample);
    const installed = (family) => Math.abs(measure(family, sansSample) - sentinel) > 0.5;
    const box = (family, text) => {
      ctx.font = `100px ${JSON.stringify(family)}`;
      const m = ctx.measureText(text);
      return { ascent: m.fontBoundingBoxAscent / 100, descent: m.fontBoundingBoxDescent / 100 };
    };
    /**
     * 兜底字面要抄进 CSS 的三个数：size-adjust 对齐宽度，
     * ascent/descent-override 对齐行盒（= 网页字体度量 ÷ size-adjust）。
     * 只报 size-adjust 不够：第 72 轮那个「粗体多一行」就是行盒没对齐。
     */
    const cssNumbers = (webFamily, family, text) => {
      const web = box(webFamily, text);
      const adjust = webWidthOf(webFamily, text) / webWidthOf(family, text);
      const fb = box(family, text);
      return {
        sizeAdjust: +(adjust * 100).toFixed(1),
        ascent: +((web.ascent / adjust) * 100).toFixed(1),
        descent: +((web.descent / adjust) * 100).toFixed(1),
      };
    };
    const webWidthOf = (family, text) => measure(family, text);

    await document.fonts.ready;
    const webSans = measure("Inter", sansSample);
    const webMono = measure("JetBrains Mono", monoSample);
    const webSerif = measure("Instrument Serif", serifSample);

    // body 实际命中的字体：拿它的宽度去和候选字体比对，谁最接近就是谁
    const probe = document.createElement("span");
    probe.textContent = sansSample;
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font-size:100px";
    document.body.appendChild(probe);
    const bodyWidth = probe.getBoundingClientRect().width;
    probe.remove();
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
      serif: {
        webWidth: Math.round(webSerif),
        candidates: serifCandidates.map((family) => {
          const ok = installed(family);
          if (!ok) return { family, installed: false, ratio: null, css: null };
          const ratio = +(webSerif / measure(family, serifSample)).toFixed(3);
          return { family, installed: true, ratio, css: cssNumbers("Instrument Serif", family, serifSample) };
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
  {
    sansSample: SANS_SAMPLE,
    monoSample: MONO_SAMPLE,
    serifSample: SERIF_SAMPLE,
    sansCandidates: SANS_CANDIDATES,
    monoCandidates: MONO_CANDIDATES,
    serifCandidates: SERIF_CANDIDATES,
  },
);

/**
 * 布局对比：把同一页在「字体被拦住（只有兜底）」和「正常」两种状态下的
 * 首屏元素高度/位置比一遍 —— 谁变了、变了多少，一目了然。
 * 比"看 layout-shift 的 sources"更硬：不依赖时序，不受 runner 快慢影响。
 */
async function collectLayout(page) {
  return page.evaluate(() => {
    const rows = [];
    const nodes = Array.from(document.querySelectorAll("main *")).slice(0, 400);
    nodes.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) return;
      rows.push({
        key: String(index),
        tag: `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").slice(0, 2).join(".") : ""}`.slice(0, 60),
        y: Math.round(rect.y + window.scrollY),
        h: Math.round(rect.height),
        text: (el.textContent ?? "").trim().slice(0, 40),
      });
    });
    return { rows, docHeight: Math.round(document.documentElement.scrollHeight) };
  });
}

let layoutDiff = null;
if (LAYOUT_DIFF) {
  const fallbackOnly = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await fallbackOnly.route("**/*.woff2", (route) => route.abort());
  await fallbackOnly.goto(`${base}/invest/market/`, { waitUntil: "load" });
  await fallbackOnly.evaluate(() => document.fonts.ready);
  await fallbackOnly.waitForTimeout(500);
  const before = await collectLayout(fallbackOnly);
  await fallbackOnly.close();

  const normal = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await normal.goto(`${base}/invest/market/`, { waitUntil: "load" });
  await normal.evaluate(() => document.fonts.ready);
  await normal.waitForTimeout(500);
  const after = await collectLayout(normal);
  await normal.close();

  const byKey = new Map(after.rows.map((row) => [row.key, row]));
  const changes = [];
  for (const row of before.rows) {
    const next = byKey.get(row.key);
    if (!next) continue;
    const dh = next.h - row.h;
    const dy = next.y - row.y;
    if (Math.abs(dh) >= 4 || Math.abs(dy) >= 4) {
      changes.push({ tag: row.tag, from: `${row.y}px/${row.h}px`, to: `${next.y}px/${next.h}px`, dh, dy, text: row.text });
    }
  }
  changes.sort((a, b) => Math.abs(b.dh) + Math.abs(b.dy) - (Math.abs(a.dh) + Math.abs(a.dy)));
  layoutDiff = {
    docHeightDelta: after.docHeight - before.docHeight,
    changed: changes.slice(0, 6),
    changedCount: changes.length,
  };
}

await browser.close();
server.close();

if (JSON_MODE) {
  // 一行 JSON：CI 的 notice 只适合放短字符串
  const brief = {
    sans: report.sans.candidates.filter((row) => row.installed).map((row) => `${row.family}@${row.ratio}`),
    mono: report.mono.candidates.filter((row) => row.installed).map((row) => `${row.family}@${row.ratio}`),
    body: report.sans.resolvedLike,
    serif: report.serif.candidates
      .filter((row) => row.installed)
      .map((row) => `${row.family}:${row.css.sizeAdjust}/${row.css.ascent}/${row.css.descent}`),
  };
  if (layoutDiff) brief.layout = { doc: layoutDiff.docHeightDelta, top: layoutDiff.changed.slice(0, 3).map((c) => `${c.tag} ${c.dh}px`) };
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
  console.log(`\n衬线（Instrument Serif 宽 ${report.serif.webWidth}px）`);
  for (const row of report.serif.candidates) {
    if (!row.installed) {
      console.log(`  ✗ ${row.family.padEnd(18)} 未安装`);
      continue;
    }
    console.log(
      `  ✓ ${row.family.padEnd(18)} size-adjust: ${row.css.sizeAdjust}%  ` +
        `ascent-override: ${row.css.ascent}%  descent-override: ${row.css.descent}%`,
    );
  }
  if (layoutDiff) {
    console.log(`\n布局对比（拦字体 vs 正常）：文档高度变化 ${layoutDiff.docHeightDelta}px，变动元素 ${layoutDiff.changedCount} 个`);
    for (const row of layoutDiff.changed) {
      console.log(`  ${row.dh > 0 ? "+" : ""}${row.dh}px  ${{".tag": row.tag}} ${row.from} → ${row.to}  「${row.text}」`);
    }
  }
  console.log(`\n（✗ = 这台机器没装。数字是"网页字体宽度 ÷ 该字体宽度"，即该兜底要用的 size-adjust）`);
}
