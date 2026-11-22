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
import { readdirSync } from "node:fs";
import path from "node:path";
import { evaluatePage, evaluateRendered } from "./lib/degraded.mjs";

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
const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice("--only=".length);
const scenarios = only ? [only] : ["api", "storage"];

const DIST = new URL("../dist", import.meta.url).pathname;
const server = await serveDist(DIST);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath() });
const failures = [];

/** 打开一页并收集渲染证据；scenario 决定怎么把它弄坏。 */
async function probe(path, scenario) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 120)));
  if (scenario === "api") {
    // 所有接口一律 500：模拟后端整体不可用
    await page.route("**/api/**", (route) => {
      apiFailures.push(route.request().url().replace(base, ""));
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"降级探针"}' });
    });
  } else {
    // 存储被策略禁用：Chrome 全禁 cookie / 隐私插件下，访问 localStorage 会抛 SecurityError
    await context.addInitScript(() => {
      const boom = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      Storage.prototype.getItem = boom;
      Storage.prototype.setItem = boom;
      Storage.prototype.removeItem = boom;
    });
  }
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
    let storageBlocked = false;
    try {
      localStorage.getItem("probe");
    } catch {
      storageBlocked = true;
    }
    return { text: (main?.innerText ?? "").slice(0, 20_000), heading, storageBlocked };
  });
  return { page, context, status, pageErrors, apiFailures, ...snapshot };
}

for (const scenario of scenarios) {
  for (const path of paths) {
    const probeResult = await probe(path, scenario);
    const { page, context, status, pageErrors, apiFailures, text, heading, storageBlocked } = probeResult;

    // 键盘导航（j/k）只有在存储可用时才展示提示；存储被禁时**不许连累翻页**（第 167 轮的真 bug）
    let keyboard = null;
    if (scenario === "storage") {
      const prevHref = await page.evaluate(() => /prevHref\s*=\s*"([^"]+)"/.exec(document.documentElement.innerHTML)?.[1] ?? "");
      if (prevHref) {
        const before = page.url();
        await page.keyboard.press("k");
        await page.waitForTimeout(1500);
        keyboard = { prevHref, navigated: page.url() !== before };
      }
    }
    await context.close();

    const problems = evaluateRendered({ status, pageErrors, text, heading });
    if (scenario === "api" && apiFailures.length === 0) problems.push("没有观察到任何接口失败 —— 桩没生效，检查不可信");
    if (scenario === "storage" && !storageBlocked) problems.push("存储没有被禁掉 —— 桩没生效，检查不可信");
    if (keyboard && !keyboard.navigated) problems.push(`按 k 没有跳到 ${keyboard.prevHref}（提示脚本把翻页连累了）`);

    const label = scenario === "api" ? "接口全挂" : "存储被禁";
    if (problems.length === 0) {
      const extra = keyboard ? `，按 k 仍能翻页` : apiFailures.length ? `，${apiFailures.length} 个接口失败` : "";
      console.log(`✓ [${label}] ${path}${extra}`);
    } else {
      console.log(`✗ [${label}] ${path}`);
      for (const problem of problems) console.log(`    ${problem}`);
      failures.push(`${label} ${path}`);
    }
  }
}

// 存储被禁时还有一个专门的回归点：详情页的 j/k 键盘导航。
// 第 167 轮的真 bug —— showHint() 在 `location.href = …` 之前读 localStorage，
// 存储一抛 SecurityError，翻页就整体失效（用户只是按了键，没反应）。
// 上面的目标页都没有 prevHref，所以单独挑最新一篇日报来验。
if (scenarios.includes("storage")) {
  const digests = readdirSync(new URL("../dist/ai", import.meta.url))
    .filter((name) => name.startsWith("digest-"))
    .sort()
    .reverse();
  const newest = digests.find((name) => {
    try {
      return readdirSync(new URL(`../dist/ai/${name}`, import.meta.url)).includes("index.html");
    } catch {
      return false;
    }
  });
  if (!newest) {
    console.log("✗ [存储被禁] 找不到任何日报页，键盘导航无法验证");
    failures.push("键盘导航（找不到样本）");
  } else {
    const result = await probe(`/ai/${newest}/`, "storage");
    const { page, context, status, pageErrors, text, heading, storageBlocked } = result;
    const prevHref = await page.evaluate(() => /prevHref\s*=\s*"([^"]+)"/.exec(document.documentElement.innerHTML)?.[1] ?? "");
    const before = page.url();
    if (prevHref) {
      await page.keyboard.press("k");
      await page.waitForTimeout(1500);
    }
    const navigated = page.url() !== before;
    await context.close();
    const problems = evaluateRendered({ status, pageErrors, text, heading });
    if (!storageBlocked) problems.push("存储没有被禁掉 —— 桩没生效，检查不可信");
    if (!prevHref) problems.push("这篇日报没有 prevHref，键盘导航无法验证（样本失效）");
    if (!navigated) problems.push(`按 k 没有跳到 ${prevHref || "（上一篇）"} —— 提示脚本把翻页连累了`);
    if (problems.length === 0) {
      console.log(`✓ [存储被禁] /ai/${newest}/，按 k 仍能翻到 ${prevHref}`);
    } else {
      console.log(`✗ [存储被禁] /ai/${newest}/`);
      for (const problem of problems) console.log(`    ${problem}`);
      failures.push(`存储被禁 键盘导航 ${newest}`);
    }
  }
}

await browser.close();
await server.close();

if (failures.length) {
  console.log(`\n✗ 接口不可用时有 ${failures.length} 个模板读不下去：${failures.join("、")}`);
  process.exit(1);
}
console.log(`\n✓ 降级自检通过：${paths.length} 个模板 × ${scenarios.length} 种降级（接口全挂 / 存储被禁）仍可读`);
