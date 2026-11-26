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
 *   node scripts/report-page-weight.mjs --budget             # 当闸门用：超过基线 15% 就红
 *   node scripts/report-page-weight.mjs --update-budget      # 复核后重登记基线
 *
 * ⚠️ `/api/*` 在本地一定 404（serveDist 没有后端），而 404 的响应体就是整页 404 页面（~130 KB），
 * 会把这几个页面虚增 500 KB 以上。报表默认剔除它们，并在输出里注明剔除了几条 ——
 * 第 222 轮第一次测的时候，我差点把"本地没有后端"当成"线上页面很重"。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "scripts", "page-weight-runtime-baseline.json");
/** 基线之上留 15% 余量：这点空间够正常内容增长，又拦得住"又挂了一个大 island"这种事故。 */
const BUDGET_RATIO = 1.15;

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

/**
 * 拿实测值和基线比。纯函数，测试用。
 * 基线里没有的页面只报不判 —— 新页面不该让闸门红，但也不该悄悄逃过登记。
 */
export function judgeBudget(report, baseline, ratio = BUDGET_RATIO) {
  const over = [];
  const unregistered = [];
  for (const row of report) {
    const limit = baseline[row.path];
    if (typeof limit !== "number") { unregistered.push(row.path); continue; }
    // 基线文件里记的是 KB（便于人读），实测是字节 —— 单位必须在一处对齐，否则上限会变成 1 KB。
    const baselineBytes = limit * 1024;
    const allowed = Math.round(baselineBytes * ratio);
    if (row.bytes > allowed) {
      over.push({ path: row.path, measured: row.bytes, allowed, baseline: baselineBytes });
    }
  }
  return { ok: over.length === 0, over, unregistered };
}

function parseArgs(argv) {
  const args = { dist: "dist", width: 390, height: 844, dpr: 2, json: false, paths: null, budget: false, updateBudget: false };
  for (const arg of argv) {
    if (arg.startsWith("--dist=")) args.dist = arg.slice(7);
    else if (arg.startsWith("--width=")) args.width = Number(arg.slice(8));
    else if (arg.startsWith("--height=")) args.height = Number(arg.slice(9));
    else if (arg.startsWith("--dpr=")) args.dpr = Number(arg.slice(6));
    else if (arg.startsWith("--paths=")) args.paths = arg.slice(8).split(",").filter(Boolean);
    else if (arg === "--json") args.json = true;
    else if (arg === "--budget") args.budget = true;
    else if (arg === "--update-budget") args.updateBudget = true;
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

  if (args.updateBudget) {
    const next = {};
    for (const row of report) next[row.path] = Math.round(row.bytes / 1024);
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`已重登记基线：${Object.keys(next).length} 个页面 → ${path.relative(ROOT, BASELINE)}`);
    return 0;
  }

  let verdict = null;
  if (args.budget) {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    verdict = judgeBudget(report, baseline);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ viewport: `${args.width}x${args.height}@${args.dpr}x`, report, verdict }, null, 2)}\n`);
    return verdict && !verdict.ok ? 1 : 0;
  }
  console.log(`手机视口 ${args.width}×${args.height} @${args.dpr}x（本地构建，未压缩；` +
    "线上 nginx 会 gzip，HTML/JS 约压到 1/3）");
  for (const row of report) {
    const top = row.top.slice(0, 3).map(([type, size]) => `${type} ${Math.round(size / 1024)}KB`).join(" / ");
    const note = row.skipped ? `  （已剔除 ${row.skipped} 条 /api/** 本地 404 噪声）` : "";
    console.log(`${row.path.padEnd(26)} ${(row.bytes / 1024).toFixed(0).padStart(5)} KB / ${String(row.requests).padStart(3)} 请求  ← ${top}${note}`);
  }
  if (verdict) {
    for (const row of verdict.over) {
      console.log(`✗ ${row.path}：${(row.measured / 1024).toFixed(0)} KB > 上限 ${(row.allowed / 1024).toFixed(0)} KB（基线 ${row.baseline} KB）`);
    }
    for (const p of verdict.unregistered) console.log(`· ${p} 还没有基线（只报不判，复核后用 --update-budget 登记）`);
    console.log(verdict.ok
      ? "✓ 手机端重量都在预算内"
      : `✗ ${verdict.over.length} 个页面超出手机端重量预算`);
  }
  return verdict && !verdict.ok ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
