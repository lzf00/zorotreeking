#!/usr/bin/env node
/**
 * 自动生成的内容必须在页面上说出来（第 210 轮）。
 *
 * 线上实测（2026-11-26）：193 篇 AI 日报 + 23 篇周报的正文**没有一句**说明，
 * 读者只能从一个标签 chip「auto」猜；同时 JSON-LD 里 author 一律是
 * `Person: Zifei Liu` —— 机器整理的文字被标成个人署名。投资站复盘有正文声明，
 * 但结构化数据同样署人名。
 *
 * 这个检查扫构建产物：
 *   1. 自动产出的文章页（按 URL 前缀判定）必须有 [data-auto-disclosure]
 *   2. 这些页的 Article JSON-LD 必须有 contributor（组织），不能说成纯人写
 *   3. 人写的文章页不许有这条声明（否则就是把人的内容说成机器的）
 *
 * 用法：node scripts/check-auto-disclosure.mjs [--dist=dist]
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** 与 src/lib/auto-content.ts 的 AUTO_RULES 保持一致（有测试盯着两份别漂） */
export const AUTO_PREFIXES = [
  "/invest/market-recap-",
  "/en/invest/market-recap-",
  "/invest/digest-",
  "/en/invest/digest-",
  "/ai/digest-",
  "/en/ai/digest-",
  "/ai/weekly-",
  "/en/ai/weekly-",
];

export function isAutoPage(routePath) {
  return AUTO_PREFIXES.some((p) => routePath.startsWith(p));
}

/** 页面里有没有声明块 → 返回 kind 或 null */
export function disclosureKind(html) {
  const m = /data-auto-disclosure="([a-z]+)"/.exec(html);
  return m ? m[1] : null;
}

/** Article JSON-LD 里有没有 contributor */
export function hasContributor(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      if (node?.["@type"] === "Article" && node.contributor) return true;
    }
  }
  return false;
}

/** 纯函数：给定一批 {route, html} 给出违规列表 */
export function judge(pages) {
  const violations = [];
  for (const { route, html } of pages) {
    const auto = isAutoPage(route);
    const kind = disclosureKind(html);
    const contributor = hasContributor(html);
    if (auto && !kind) violations.push({ route, problem: "自动产出但页面没有声明" });
    if (auto && !contributor) violations.push({ route, problem: "自动产出但 JSON-LD 没有 contributor" });
    if (!auto && kind) violations.push({ route, problem: "人写的内容被标成自动生成" });
  }
  return violations;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name === "index.html") yield full;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const distArg = args.find((a) => a.startsWith("--dist="));
  const dist = distArg ? distArg.slice("--dist=".length) : "dist";
  const pages = [];
  for await (const file of walk(dist)) {
    const route = `/${path.relative(dist, path.dirname(file)).replace(/\\/g, "/")}/`.replace("//", "/");
    pages.push({ route, html: await readFile(file, "utf8") });
  }
  const violations = judge(pages);
  const autoCount = pages.filter((p) => isAutoPage(p.route)).length;
  if (!violations.length) {
    console.log(`✓ ${autoCount} 个自动产出页面都有声明与 contributor，人写页面无声明`);
    process.exit(0);
  }
  for (const v of violations.slice(0, 20)) {
    console.error(`::error title=自动产出声明::${v.route} ${v.problem}`);
  }
  console.error(`✗ ${violations.length} 个页面声明不对（共 ${pages.length} 页）`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  await main();
}
