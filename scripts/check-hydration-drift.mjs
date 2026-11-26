#!/usr/bin/env node
/**
 * 跨天 / 跨时区扫一遍：SSR 与客户端算出来的字必须一样（第 217 轮）。
 *
 * 第 215、216 两轮连着抓到两只同一类 bug：
 *   · 「（非今日）」在 SSR 里算 → 跨天访问 React #418；
 *   · `/invest/us-market/` 的「（今天）／N 天前」在渲染里读时钟 → 同样 #418。
 * 两处的共同点不是代码写错，而是**渲染路径里读了环境**（时钟、时区、语言）。
 * 这类 bug 有个讨厌的性质：构建时刻和访问时刻一致时完全看不出来，
 * 只在"跨过某个边界"的那部分访问者身上出现 —— 本地跑一遍永远绿。
 *
 * 所以这个门禁换了种测法：不去静态扫描源码（做不到准），而是**把环境弄歪再打开页面**：
 *   1. 浏览器时钟拨后 10 天（跨天：快照不再"是今天"，日期文案全部错位）；
 *   2. 浏览器时区设成 America/New_York + 英文（跨时区：任何 toLocaleString()/本地时区取值都会露馅）。
 * 只要有一页抛 pageerror（#418 就是 hydration mismatch），这次就红。
 *
 * 页面不固定：按内容类型抽样（`sectionOf`），seed 默认本周，所以每周自动换一批，
 * 覆盖会随时间铺开 —— 和 `check:a11y:sample` 同一套思路。
 *
 * 用法：
 *   node scripts/check-hydration-drift.mjs               # 抽样 12 页 × 2 种环境
 *   node scripts/check-hydration-drift.mjs --sample=24
 *   node scripts/check-hydration-drift.mjs --seed=2026-W48
 *   node scripts/check-hydration-drift.mjs --paths=/invest/us-market/,/ai/digest-2026-11-25/
 *   node scripts/check-hydration-drift.mjs --json
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isThirdPartyConsoleNoise } from "./lib/console-noise.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 一组模板用同一个抽样器：`/ai/digest-2026-11-25/` 与 `/ai/digest-2026-06-05/` 同类。 */
export function templateSignature(pathname) {
  return pathname
    .replace(/\d{4}-\d{2}-\d{2}/g, ":date")
    .replace(/W\d{2}/g, ":week")
    .replace(/\/\d+(\/|$)/g, "/:n$1");
}

/**
 * 两种"歪环境"。数值写死，方便测试断言它们真的够歪。
 */
export function driftVariants() {
  return [
    {
      id: "clock+10d",
      why: "跨天：任何在渲染里读时钟的文案都会和 SSR 不一致",
      shiftDays: 10,
      timezoneId: "Asia/Shanghai",
      locale: "zh-CN",
    },
    {
      id: "tz-America/New_York+en",
      why: "跨时区/跨语言：本地时区取值与默认 locale 的格式化都会露馅",
      shiftDays: 0,
      timezoneId: "America/New_York",
      locale: "en-US",
    },
  ];
}

/** 把一次探针的结果折叠成"有没有问题"。纯函数，测试用。 */
export function summarise(results) {
  const failures = results.filter((r) => r.errors.length > 0);
  return {
    ok: failures.length === 0,
    checked: results.length,
    failures: failures.map((r) => ({ path: r.path, variant: r.variant, errors: r.errors })),
  };
}

function parseArgs(argv) {
  const args = { dist: "dist", sample: 12, seed: weeklySeed(), paths: null, json: false };
  for (const arg of argv) {
    if (arg.startsWith("--dist=")) args.dist = arg.slice(7);
    else if (arg.startsWith("--sample=")) args.sample = Number(arg.slice(9));
    else if (arg.startsWith("--seed=")) args.seed = arg.slice(7);
    else if (arg.startsWith("--paths=")) args.paths = arg.slice(8).split(",").filter(Boolean);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

function weeklySeed(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  const first = new Date(Date.UTC(shifted.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((shifted - first) / 86400000 + first.getUTCDay() + 1) / 7);
  return `${shifted.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function pickPaths(dist, args) {
  if (args.paths) return args.paths;
  const xml = await readFile(path.join(dist, "sitemap.xml"), "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const { samplePaths } = await import("./lib/a11y-sample.mjs");
  return samplePaths(urls, { count: args.sample, seed: args.seed });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const routes = await pickPaths(args.dist, args);
  const { chromium } = await import("playwright");
  const { chromePath, serveDist } = await import("./lib/serve-dist.mjs");
  const server = await serveDist(args.dist);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath() });
  const variants = driftVariants();
  const results = [];
  for (const variant of variants) {
    for (const route of routes) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: variant.timezoneId,
        locale: variant.locale,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        if (/Failed to load resource/.test(text)) return;
        if (isThirdPartyConsoleNoise(text, m.location()?.url ?? "")) return;
        errors.push(`console: ${text.slice(0, 160)}`);
      });
      if (variant.shiftDays) {
        await page.addInitScript(`{
          const fixed = Date.now() + ${variant.shiftDays} * 24 * 3600 * 1000;
          const RealDate = Date;
          class FakeDate extends RealDate {
            constructor(...a) { super(...(a.length ? a : [fixed])); }
            static now() { return fixed; }
          }
          window.Date = FakeDate;
        }`);
      }
      try {
        await page.goto(base + route, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(600);
      } catch (error) {
        errors.push(`goto: ${String(error).slice(0, 120)}`);
      }
      results.push({ path: route, variant: variant.id, errors });
      await context.close();
    }
  }
  await browser.close();
  server.close();

  const verdict = summarise(results);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ seed: args.seed, routes, ...verdict }, null, 2)}\n`);
  } else {
    console.log(`抽样 ${routes.length} 页 × ${variants.length} 种环境（seed=${args.seed}）`);
    for (const variant of variants) console.log(`  · ${variant.id}：${variant.why}`);
    for (const failure of verdict.failures) {
      console.log(`✗ ${failure.path} [${failure.variant}] ← ${failure.errors[0]}`);
    }
    console.log(
      verdict.ok
        ? `✓ 跨天/跨时区访问没有 hydration 报错（${verdict.checked} 次加载）`
        : `✗ ${verdict.failures.length}/${verdict.checked} 次加载出现 hydration 报错`,
    );
  }
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
