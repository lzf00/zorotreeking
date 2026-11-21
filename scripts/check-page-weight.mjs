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
import { gzipSync } from "node:zlib";
import { join, relative } from "node:path";

import { BUDGETS, countTags, evaluatePages, kb, parseStyleBytes } from "./lib/page-weight.mjs";

/** 判断一条基线理由是不是我们自动生成的（自动理由每轮重算，人工理由保留）。 */
const AUTO_REASON_PREFIXES = [
  "路线页：内联 CSS 超过",
  "gzip 后超过",
  "标签数超过 3000",
  "既有页面，HTML 超过",
];
const isAutoReason = (reason) => AUTO_REASON_PREFIXES.some((prefix) => reason.startsWith(prefix));

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
  return {
    path: `/${rel}`,
    file,
    htmlBytes: html.length,
    cssBytes: parseStyleBytes(html),
    gzipBytes: gzipSync(html, { level: 9 }).length,
    tags: countTags(html),
  };
});

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const { failures, warnings, heaviest, heaviestByGzip } = evaluatePages(pages, baseline);

if (process.argv.includes("--update-baseline")) {
  const next = {};
  for (const page of pages) {
    const known = baseline[page.path];
    // 已经瘦回预算内的页面要移出基线（否则白名单只增不减，闸门逐渐失效）
    if (
      page.htmlBytes <= BUDGETS.htmlBytes &&
      page.cssBytes <= BUDGETS.cssBytes &&
      page.gzipBytes <= BUDGETS.gzipBytes &&
      page.tags <= BUDGETS.tags
    ) continue;
    next[page.path] = {
      htmlBytes: page.htmlBytes,
      cssBytes: page.cssBytes,
      gzipBytes: page.gzipBytes,
      tags: page.tags,
      // 旧的**自动**理由不能覆盖新算出来的具体理由（否则路线页会一直写着"列表页"、
      // 瘦身后的标签页还写着"标签数超过 3000"）。人工写的理由仍然优先保留。
      reason:
        (known && !isAutoReason(known.reason) ? known.reason : null) ??
        (page.cssBytes > BUDGETS.cssBytes
          ? "路线页：内联 CSS 超过 120 KB（地图控件与路线详情的既有样式），gzip 也超 60 KB"
          : page.gzipBytes > BUDGETS.gzipBytes
            ? "gzip 后超过 60 KB（全站中位 37 KB）"
            : page.tags > BUDGETS.tags
              ? "标签数超过 3000（DOM 节点偏多）"
              : "既有页面，HTML 超过 220 KB 预算（列表/摘要页一次渲染全部条目）"),
    };
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✅ 基线已更新：${Object.keys(next).length} 个页面`);
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ pages: pages.length, failures, warnings, heaviest }, null, 2));
} else {
  console.log(`页面重量：${pages.length} 页 · 预算 HTML ${kb(BUDGETS.htmlBytes)} / CSS ${kb(BUDGETS.cssBytes)} / gzip ${kb(BUDGETS.gzipBytes)} / ${BUDGETS.tags} 标签`);
  for (const page of heaviest) console.log(`  最重 ${kb(page.htmlBytes).padStart(8)}  ${page.path}`);
  console.log(`  传输（gzip）最重：`);
  for (const page of heaviestByGzip) console.log(`  ${kb(page.gzipBytes).padStart(8)} · ${page.tags} tags · ${kb(page.htmlBytes)} raw  ${page.path}`);
  for (const warning of warnings) console.log(`  ⚠️  ${warning}`);
  for (const failure of failures) console.log(`  ❌ ${failure.path}: ${failure.message}`);
  if (!failures.length) console.log("✅ 没有页面超出重量预算");
}
process.exit(failures.length ? 1 : 0);
