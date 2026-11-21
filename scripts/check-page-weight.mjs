#!/usr/bin/env node
/**
 * 页面重量闸门（第 131 轮）。
 *
 * `node scripts/check-page-weight.mjs`           # 检查 dist/
 * `node scripts/check-page-weight.mjs --update-baseline`  # 把当前超标页面写进基线
 * `node scripts/check-page-weight.mjs --json`    # 机器可读
 *
 * 阈值与理由见 scripts/lib/page-weight.mjs。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { BUDGETS, evaluatePages, kb, parseStyleBytes } from "./lib/page-weight.mjs";

const ROOT = "dist";
const BASELINE = "scripts/page-weight-baseline.json";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name === "index.html") out.push(path);
  }
  return out;
}

const files = walk(ROOT);
const pages = files.map((file) => {
  const html = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/index\.html$/, "");
  return { path: `/${rel}`, file, htmlBytes: html.length, cssBytes: parseStyleBytes(html) };
});

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const { failures, warnings, heaviest } = evaluatePages(pages, baseline);

if (process.argv.includes("--update-baseline")) {
  const next = {};
  for (const page of pages) {
    const known = baseline[page.path];
    if (!known && page.htmlBytes <= BUDGETS.htmlBytes && page.cssBytes <= BUDGETS.cssBytes) continue;
    next[page.path] = {
      htmlBytes: page.htmlBytes,
      cssBytes: page.cssBytes,
      reason:
        known?.reason ??
        (page.htmlBytes > BUDGETS.htmlBytes
          ? "既有页面，HTML 超过 220 KB 预算（列表/摘要页一次渲染全部条目）"
          : "路线页：内联 CSS 超过 120 KB（地图控件与路线详情的既有样式）"),
    };
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✅ 基线已更新：${Object.keys(next).length} 个页面`);
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ pages: pages.length, failures, warnings, heaviest }, null, 2));
} else {
  console.log(`页面重量：${pages.length} 页 · 预算 HTML ${kb(BUDGETS.htmlBytes)} / CSS ${kb(BUDGETS.cssBytes)}`);
  for (const page of heaviest) console.log(`  最重 ${kb(page.htmlBytes).padStart(8)}  ${page.path}`);
  for (const warning of warnings) console.log(`  ⚠️  ${warning}`);
  for (const failure of failures) console.log(`  ❌ ${failure.path}: ${failure.message}`);
  if (!failures.length) console.log("✅ 没有页面超出重量预算");
}
process.exit(failures.length ? 1 : 0);
