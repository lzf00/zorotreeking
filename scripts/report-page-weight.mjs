#!/usr/bin/env node
/**
 * 「这个站用手机打开到底有多重」—— 一次真实加载的资源总量报表（第 222 轮）。
 *
 * 和 `check:weight` 的分工：
 *   `check:weight`     看构建产物本身（HTML + 内联 CSS 的 gzip 体积），是**闸门**，逐页预算；
 *   `report:weight`    在浏览器里按手机视口真实加载一次，统计**所有**资源（文档/脚本/字体/图片/fetch），
 *                      是**报表**，用于回答"这次改动让首屏多了多少 KB"。
 *
 * 用法：
 *   node scripts/report-page-weight.mjs                      # 8 个代表页
 *   node scripts/report-page-weight.mjs --paths=/invest/,/photo/
 *   node scripts/report-page-weight.mjs --width=390 --height=844
 *   node scripts/report-page-weight.mjs --json
 *
 * ⚠️ `/api/*` 在本地一定 404（serveDist 没有后端），而 404 的响应体就是整页 404 页面（~130 KB），
 * 会把这几个页面虚增 500 KB 以上。报表默认剔除它们，并在输出里注明剔除了几条 ——
 * 第 222 轮第一次测的时候，我差点把"本地没有后端"当成"线上页面很重"。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 本地没有后端时 `/api/**` 的响应体是 404 页面，属于测量噪声而不是页面重量。 */
export function isLocalApiArtifact(pathname) {
  return pathname.startsWith("/api/");
}

/** 把每条资源折成"哪个页面多重、重在哪"。纯函数，测试用。 */
export function summariseTransfer(rows) {
  const kept = rows.filter((row) => !isLocalApiArtifact(new URL(row.url, "https://example.com").pathname));
  const skipped = rows.length - kept.length;
  const byType = new Map();
  let bytes = 0;
  for (const row of kept) {
    bytes += row.bytes;
    byType.set(row.type, (byType.get(row.type) ?? 0) + row.bytes);
  }
  const top = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  return { bytes, requests: kept.length, skipped, top, byType };
}

function parseArgs(argv) {
  const args = { dist: "dist", width: 390, height: 844, dpr: 2, json: false, paths: null };
  for (const arg of argv) {
    if (arg.startsWith("--dist=")) args.dist = arg.slice(7);
    else if (arg.startsWith("--width=")) args.width = Number(arg.slice(8));
    else if (arg.startsWith("--height=")) args.height = Number(arg.slice(9));
    else if (arg.startsWith("--dpr=")) args.dpr = Number(arg.slice(6));
    else if (arg.startsWith("--paths=")) args.paths = arg.slice(8).split(",").filter(Boolean);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

const DEFAULT_PATHS = [
  "/", "/ai/", "/ai/digest-2026-11-26/", "/photo/", "/photo/baokemeng/",
  "/hike/", "/invest/", "/archive/",
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const routes = args.paths ?? DEFAULT_PATHS;
  const { chromium } = await import("playwright");
  const { chromePath, serveDist } = await import("./lib/serve-dist.mjs");
  const server = await serveDist(args.dist);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath() });
  const report = [];
  for (const route of routes) {
    const context = await browser.newContext({
      viewport: { width: args.width, height: args.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: args.dpr,
    });
    const page = await context.newPage();
    const rows = [];
    page.on("response", async (response) => {
      try {
        const declared = Number(response.headers()["content-length"] || 0);
        const body = declared ? null : await response.body().catch(() => null);
        rows.push({
          url: response.url(),
          type: response.request().resourceType(),
          bytes: declared || body?.length || 0,
        });
      } catch {
        /* 有些响应取不到 body（304/中止），忽略即可 */
      }
    });
    await page.goto(base + route, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    report.push({ path: route, ...summariseTransfer(rows) });
    await context.close();
  }
  await browser.close();
  server.close();

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ viewport: `${args.width}x${args.height}@${args.dpr}x`, report }, null, 2)}\n`);
    return 0;
  }
  console.log(`手机视口 ${args.width}×${args.height} @${args.dpr}x（本地构建，未压缩；` +
    "线上 nginx 会 gzip，HTML/JS 约压到 1/3）");
  for (const row of report) {
    const top = row.top.slice(0, 3).map(([type, size]) => `${type} ${Math.round(size / 1024)}KB`).join(" / ");
    const note = row.skipped ? `  （已剔除 ${row.skipped} 条 /api/** 本地 404 噪声）` : "";
    console.log(`${row.path.padEnd(26)} ${(row.bytes / 1024).toFixed(0).padStart(5)} KB / ${String(row.requests).padStart(3)} 请求  ← ${top}${note}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
