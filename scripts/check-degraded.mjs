#!/usr/bin/env node
/**
 * 接口全挂时，页面还是不是页面（第 166 轮）。
 *
 * 全站的接口都藏在"前端静默降级"后面，但**没有任何检查测过降级那一半**：
 * check:runtime 把 `/api/**` 桩成 200，部署后 smoke 只打真实接口。于是"接口挂了页面白屏"
 * 这种事故只会在线上被人看见。
 *
 * 做法：静态服务器 + 把 `/api/**` 全部拦成 500，再逐页加载关键模板，看页面是否仍然可读。
 *
 * 用法：
 *   node scripts/check-degraded.mjs            # 抽查关键模板
 *   node scripts/check-degraded.mjs --paths=/invest/us-market/,/invest/market/
 */
import { chromium } from "playwright";
import { chromePath, serveDist } from "./lib/serve-dist.mjs";
import { evaluatePage } from "./lib/degraded.mjs";

const TARGETS = [
  "/",
  "/invest/",
  "/invest/market/",
  "/invest/us-market/",
  "/ai/",
  "/photo/",
];

const arg = process.argv.find((a) => a.startsWith("--paths="));
const paths = arg ? arg.slice("--paths=".length).split(",").filter(Boolean) : TARGETS;

const DIST = new URL("../dist", import.meta.url).pathname;
const server = await serveDist(DIST);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath() });
const failures = [];

for (const path of paths) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 120)));
  // 所有接口一律 500：模拟后端整体不可用
  await page.route("**/api/**", (route) => {
    apiFailures.push(route.request().url().replace(base, ""));
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"降级探针"}' });
  });
  let status = 0;
  try {
    const response = await page.goto(base + path, { waitUntil: "load", timeout: 60_000 });
    status = response?.status() ?? 0;
    await page.waitForTimeout(900); // 让挂载后的 fetch 全部失败并渲染
  } catch (error) {
    pageErrors.push(`导航失败：${String(error).slice(0, 100)}`);
  }
  const snapshot = await page.evaluate(() => {
    const heading = document.querySelector("h1")?.textContent?.trim() ?? "";
    const main = document.querySelector("main") ?? document.body;
    return { text: (main?.innerText ?? "").slice(0, 20_000), heading };
  });
  await context.close();

  const verdict = evaluatePage({ status, pageErrors, apiFailures, ...snapshot });
  if (verdict.ok) {
    console.log(`✓ ${path}（${apiFailures.length} 个接口失败，页面仍可读）`);
  } else {
    console.log(`✗ ${path}`);
    for (const problem of verdict.problems) console.log(`    ${problem}`);
    failures.push(path);
  }
}

await browser.close();
await server.close();

if (failures.length) {
  console.log(`\n✗ 接口不可用时有 ${failures.length} 个模板读不下去：${failures.join("、")}`);
  process.exit(1);
}
console.log(`\n✓ 降级自检通过：${paths.length} 个模板在接口全挂时仍可读`);
