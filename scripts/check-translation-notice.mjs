#!/usr/bin/env node
/**
 * 英文文章页必须说明「这是机翻」（第 211 轮）。
 *
 * 全站 536 篇英文文章（AI 217 + 投资 319）都由脚本从中文稿翻译而来。
 * 第 121 轮只处理了"英文页里还剩大段中文"，而**干净的**机翻更危险：
 * 通顺到读者以为措辞是作者选的。
 *
 * 扫构建产物，双向校验：
 *   1. /en/ 下的文章页（有 Article JSON-LD）必须有 [data-machine-translation]
 *   2. 这些页的 JSON-LD 必须有 translationOfWork 指向中文原文
 *   3. 中文文章页不许有这条声明（中文是原文，不是译文）
 *
 * 用法：node scripts/check-translation-notice.mjs [--dist=dist]
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** 英文侧、内容来自中文翻译的板块（与实际翻译流水线一致） */
export const TRANSLATED_PREFIXES = ["/en/ai/", "/en/invest/", "/en/hike/"];

export function isEnglishArticleRoute(route) {
  return TRANSLATED_PREFIXES.some((p) => route.startsWith(p));
}

/** 页面是不是文章页（有 Article JSON-LD，而不是列表页/索引页） */
export function articleNodes(html) {
  const out = [];
  for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    for (const node of Array.isArray(data) ? data : [data]) {
      if (node?.["@type"] === "Article") out.push(node);
    }
  }
  return out;
}

export function hasNotice(html) {
  return /data-machine-translation="1"/.test(html);
}

/** 机翻声明同样不许进搜索索引（第 212 轮，理由见 check-auto-disclosure.mjs） */
export function noticeIsIgnored(html) {
  const m = /<[a-z]+[^>]*data-machine-translation="1"[^>]*>/i.exec(html);
  if (!m) return null;
  return /data-pagefind-ignore/.test(m[0]);
}

export function judge(pages) {
  const violations = [];
  let checked = 0;
  for (const { route, html } of pages) {
    const articles = articleNodes(html);
    if (!articles.length) continue;
    const en = isEnglishArticleRoute(route);
    if (en) {
      checked += 1;
      if (!hasNotice(html)) violations.push({ route, problem: "英文文章页没有机翻声明" });
      if (noticeIsIgnored(html) === false) {
        violations.push({ route, problem: "机翻声明进了搜索索引（缺 data-pagefind-ignore）" });
      }
      if (!articles.some((a) => a.translationOfWork)) {
        violations.push({ route, problem: "英文文章页 JSON-LD 没有 translationOfWork" });
      }
    } else if (!route.startsWith("/en/") && hasNotice(html)) {
      violations.push({ route, problem: "中文原文页被标成机翻" });
    }
  }
  return { violations, checked };
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
  const { violations, checked } = judge(pages);
  if (!violations.length) {
    console.log(`✓ ${checked} 篇英文文章都标了机翻与中文原文入口，中文原文页无误标`);
    process.exit(0);
  }
  for (const v of violations.slice(0, 20)) {
    console.error(`::error title=机翻声明::${v.route} ${v.problem}`);
  }
  console.error(`✗ ${violations.length} 个页面声明不对（检查了 ${checked} 篇英文文章）`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  await main();
}
