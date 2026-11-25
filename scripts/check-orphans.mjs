#!/usr/bin/env node
/**
 * 零入链页面检查（第 204 轮）。
 *
 * 搜索引擎和读者都靠链接找页面。一个页面只要**没有任何站内链接指向它**，就等于：
 * 爬虫只能靠 sitemap 发现它、读者永远抵达不了、它的存在对站内导航是隐形的。
 * 这类页面通常来自"加了新内容类型但忘了接索引"或"分页/详情页只从 JS 里访问"。
 *
 * 本轮先量了一次：1293 个页面、47224 条站内链接，零入链 6 个 —— 其中 4 个是
 * 该被排掉的（`/404.html` 由 nginx 兜底、`/admin/*` 是 noindex 后台页），
 * 另外 2 个是旧的 `/photography/` 跳转桩（noindex + meta refresh）。
 * 也就是说**当前没有真正的孤儿页**。那就把这条量出来的事实变成常设闸门，
 * 别等哪天新加一类内容又忘接索引时才发现。
 *
 * 用法：
 *   node scripts/check-orphans.mjs            # 人类可读；有孤儿页则退出 1
 *   node scripts/check-orphans.mjs --json     # 机器可读
 *   node scripts/check-orphans.mjs --dist=DIR # 指定产物目录（默认 dist）
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** 不该有入链的页面：错误页由服务器直接返回，后台页靠地址访问 */
export const IGNORED_EXACT = new Set(["/404.html"]);
export const IGNORED_PREFIXES = ["/admin/"];

/** 把任意 href 归一化成站内页面路径（去查询串/锚点，补尾部斜杠） */
export function normalizeHref(href) {
  let clean = href.split("#")[0].split("?")[0];
  if (!clean.startsWith("/")) return null;
  if (clean.startsWith("/_astro/") || clean.startsWith("/pagefind/") || clean.startsWith("/api/")) return null;
  if (!clean.endsWith("/") && !/[^/]+\.[a-z0-9]+$/i.test(clean)) clean += "/";
  return clean;
}

/** 页面是否参与索引：有 robots noindex 就不算（后台页、跳转桩） */
export function isIndexable(html) {
  return !/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html);
}

/** 是否是"立刻跳走"的桩页：跳转桩没有入链是正常的 */
export function isRedirectStub(html) {
  return /<meta[^>]+http-equiv="refresh"/i.test(html);
}

/** 轮流产出目录下所有 html 文件 */
async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full)));
    else if (ent.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/** 文件路径 → 站点路径 */
export function pagePathOf(root, file) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"/index.html".length)}/`;
  return `/${rel}`;
}

/**
 * 纯函数：给定 `[{ page, html }]`，算每个页面的入链数。
 * 自链接不计（页面不该靠指向自己获得入链）。
 */
export function inboundCounts(entries) {
  const pages = new Map(entries.map((e) => [e.page, e]));
  const inbound = new Map([...pages.keys()].map((p) => [p, 0]));
  let edges = 0;
  for (const { page, html } of entries) {
    const seen = new Set();
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = normalizeHref(match[1]);
      if (!href) continue;
      let target = href;
      if (!pages.has(target) && pages.has(`${target}index.html`)) target = `${target}index.html`;
      if (!pages.has(target) || target === page || seen.has(target)) continue;
      seen.add(target);
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
      edges += 1;
    }
  }
  return { inbound, edges, pages };
}

/** 纯函数：从入链统计里挑出真正的孤儿页 */
export function orphans({ inbound, pages }) {
  return [...inbound.entries()]
    .filter(([page, count]) => {
      if (count > 0) return false;
      if (IGNORED_EXACT.has(page)) return false;
      if (IGNORED_PREFIXES.some((prefix) => page.startsWith(prefix))) return false;
      const entry = pages.get(page);
      if (!entry) return false;
      if (!isIndexable(entry.html) || isRedirectStub(entry.html)) return false;
      return true;
    })
    .map(([page]) => page)
    .sort();
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = args.find((a) => a.startsWith("--dist="))?.slice("--dist=".length) ?? "dist";
  const files = await walk(root);
  if (files.length === 0) {
    console.error(`::error title=零入链检查::${root} 里没有 HTML —— 这不是通过，是没测成（构建可能正在跑）`);
    process.exit(1);
  }
  const entries = [];
  for (const file of files) entries.push({ page: pagePathOf(root, file), html: await readFile(file, "utf8") });
  const graph = inboundCounts(entries);
  const zero = orphans(graph);
  const counts = [...graph.inbound.values()];
  const summary = {
    pages: entries.length,
    edges: graph.edges,
    zeroInbound: zero.length,
    orphans: zero,
    median: counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)],
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    console.log(`页面 ${summary.pages} · 站内链接 ${summary.edges} · 零入链 ${summary.zeroInbound}（中位入链 ${summary.median}）`);
    if (zero.length) {
      for (const page of zero.slice(0, 20)) console.log(`  ✗ ${page}`);
      // CI 里这一步是 warn-only，用注解让 run 页直接看见是哪几页
      for (const page of zero.slice(0, 10)) console.log(`::warning title=零入链页面::${page} 没有任何站内链接指向它`);
      console.log("  这些页面没有任何站内链接指向它们：读者到不了，爬虫只能靠 sitemap。");
    } else {
      console.log("✓ 没有真正的孤儿页（错误页 / 后台页 / 跳转桩不计）");
    }
  }
  process.exit(zero.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await main();
}
