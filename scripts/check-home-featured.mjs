#!/usr/bin/env node
/**
 * 首页首屏第一张精选卡必须是「人写的内容」（第 206 轮）。
 *
 * 线上实测：首屏第一张卡是 **2026-11-18 的股票日报**，而当天已经有 11-25 的内容。
 * 原因：注释写着"自动生成的日报/复盘不参与"，代码却只排掉了 digest；
 * market-recap 的 tag 是 `market-recap`/`wind`/`daily`，靠几十行涨跌停表格天然最长，
 * 于是把首屏占了一周。
 *
 * 修法在 `src/lib/home-selection.ts`（新增 isAutoReport），有单测。但单测用的是构造数据 ——
 * 它证明不了**线上那个 HTML** 里第一张卡到底是谁。所以这里再拦一道：直接读构建产物。
 *
 * 用法：
 *   node scripts/check-home-featured.mjs             # 默认读 dist/index.html
 *   node scripts/check-home-featured.mjs --dist=DIR
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** 自动生成内容的 URL 前缀：这些不许出现在精选头条位置 */
export const AUTO_HREF_PREFIXES = ["/ai/digest-", "/invest/digest-", "/invest/market-recap-"];

/** 精选区最多/最少几张卡 */
export const FEATURED_CARDS = 3;

/**
 * 从首页 HTML 里抽出精选区的链接（按出现顺序）。
 * 结构：`<h2>精选阅读</h2>` 之后紧跟一个 grid，里面是 3 个 <a href>。
 */
export function featuredLinks(html) {
  const at = html.indexOf("精选阅读");
  if (at < 0) return null; // 找不到区块 → 调用方按失败处理（不是"通过"）
  const section = html.slice(at);
  const end = section.indexOf("最近更新");
  const body = end > 0 ? section.slice(0, end) : section;
  // 精选卡有固定类名（SectionCard 的外层 a），用它定位卡片比"区块内所有链接"准确
  const cards = [...body.matchAll(/<a\s+href="([^"]+)"\s+class="group relative rounded-2xl/g)];
  const links = cards.length > 0 ? cards.map((m) => m[1]) : [...body.matchAll(/<a\s+href="([^"]+)"/g)].map((m) => m[1]);
  return links.slice(0, 10);
}

/**
 * 纯函数判定：返回问题列表（空数组 = 通过）。
 * @param {string[]|null} links
 */
export function judgeFeatured(links) {
  if (links === null) return ["首页里找不到「精选阅读」区块 —— 要么模板改了，要么构建产物不对"];
  if (links.length < FEATURED_CARDS) return [`精选卡只有 ${links.length} 张，应有 ${FEATURED_CARDS} 张`];
  const first = links[0];
  for (const prefix of AUTO_HREF_PREFIXES) {
    if (first.startsWith(prefix)) {
      return [`首屏第一张精选卡是自动生成的内容（${first}）—— 头条位置要求人写的内容`];
    }
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const dist = args.find((a) => a.startsWith("--dist="))?.slice("--dist=".length) ?? "dist";
  const page = path.join(dist, "index.html");
  if (!existsSync(page)) {
    console.error(`::error title=首页精选::读不到 ${page} —— 这不是通过，是没测成（先构建）`);
    process.exit(1);
  }
  const html = await readFile(page, "utf8");
  const links = featuredLinks(html);
  const problems = judgeFeatured(links);
  if (problems.length === 0) {
    console.log(`✓ 精选 ${links.length} 张卡，第一张是人写的内容：${links[0]}`);
    process.exit(0);
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  for (const p of problems) console.log(`::warning title=首页精选::${p}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await main();
}
