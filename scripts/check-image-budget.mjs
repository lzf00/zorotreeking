#!/usr/bin/env node
/**
 * 构建后检查：页面里有没有「会被真的下载的大图」。
 *
 * 背景（第 39–42 轮，连续四轮都在同一个坑里打转）：
 * - 相册 hero 用了原分辨率 webp（4K 照片 → 903 KB）
 * - 相册列表页封面直接下原图（3.7 MB/张）
 * - 内容卡片封面指向原图（滚动加载时 1139 KB + 904 KB）
 * 这些问题 Lighthouse 的 15 URL 预算量不到（页面不在清单里，或图片在首屏之外 lazy），
 * 只能靠翻 dist 发现。所以把它变成门禁的一部分。
 *
 * 判定规则（不是「引用了原图就报」，而是「会真的下载才算」）：
 * 1. `<picture>` 里已经有 `type="image/webp"` 的 `<source>` 时，`<img src>` 只是老浏览器兜底，
 *    不报警（相册网格 119 处原图兜底都属于这种，报警会淹没真问题）。
 * 2. `<picture>` 的 `<source srcset>` 与不在 `<picture>` 里的 `<img src>` 视为**会下载**，
 *    指向 `/photos/uploads/` 且文件 > 阈值（默认 300 KB）就报警。
 * 3. 派生图后缀（`.thumb.webp`/`.og.jpg`/`.w640`/`.w960`/`.hero.webp`）永远放行。
 *
 * 用法：
 *   node scripts/check-image-budget.mjs                # 检查 dist/，有超限以退出码 1 失败
 *   node scripts/check-image-budget.mjs --limit 200    # 自定义阈值（KB）
 *   node scripts/check-image-budget.mjs --warn         # 只告警不失败
 */
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));

/** 派生图后缀：这些永远是「轻量版」，直接放行 */
const DERIVED = [/\.thumb\d*\.webp$/i, /\.hero\.webp$/i, /\.og\.jpg$/i, /\.w640\.jpg$/i, /\.w960\.jpg$/i];

const isDerived = (url) => DERIVED.some((re) => re.test(url));

/** 从 srcset（`a.jpg 640w, b.jpg 960w`）里取出 URL 列表 */
export function srcsetUrls(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * 把一份 HTML 拆成「picture 块」和「裸 img 标签」，返回会被下载的图片 URL。
 * 纯函数（尺寸查询由调用方注入），方便测试。
 */
export function collectDownloadedImages(html) {
  const urls = [];
  // 1) <picture> 块：source 算下载，img src 只在没有 webp source 时算
  const pictureRe = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  for (const match of String(html).matchAll(pictureRe)) {
    const block = match[1];
    const sources = [...block.matchAll(/<source\b[^>]*>/gi)].map((m) => m[0]);
    const hasWebp = sources.some((tag) => /type\s*=\s*["']?image\/webp/i.test(tag));
    for (const tag of sources) {
      const srcset = tag.match(/srcset\s*=\s*"([^"]*)"/i)?.[1];
      if (srcset) urls.push(...srcsetUrls(srcset));
    }
    const imgSrc = block.match(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/i)?.[1];
    if (imgSrc && !hasWebp) urls.push(imgSrc);
  }
  // 2) 不在 picture 里的 <img>：一律算下载。先去掉所有 picture 块，避免重复统计。
  const withoutPictures = String(html).replace(pictureRe, "");
  for (const tag of withoutPictures.match(/<img\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*"([^"]+)"/i)?.[1];
    if (src) urls.push(src);
    const srcset = tag.match(/\bsrcset\s*=\s*"([^"]*)"/i)?.[1];
    if (srcset) urls.push(...srcsetUrls(srcset));
  }
  return urls;
}

/**
 * 找出超限的图片引用。`sizeOf(url)` 返回字节数（读不到返回 null）。
 * 返回 [{ page, url, bytes }]，按体积降序。
 */
export function findOversized(entries, sizeOf, limitBytes) {
  const seen = new Set();
  const violations = [];
  for (const entry of entries) {
    for (const raw of entry.urls) {
      const url = decodeURIComponent(raw.split("#")[0].split("?")[0]);
      if (!url.includes("/photos/uploads/")) continue;
      if (isDerived(url)) continue;
      const key = `${entry.page}\u0000${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bytes = sizeOf(url);
      if (bytes !== null && bytes > limitBytes) {
        violations.push({ page: entry.page, url, bytes });
      }
    }
  }
  return violations.sort((a, b) => b.bytes - a.bytes);
}

async function listHtml(dir) {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...(await listHtml(full)));
    else if (item.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function sizeLookup() {
  const cache = new Map();
  return (url) => {
    if (cache.has(url)) return cache.get(url);
    const path = join(PUBLIC, url.replace(/^\//, ""));
    let bytes = null;
    try {
      bytes = existsSync(path) ? require_bytes(path) : null;
    } catch {
      bytes = null;
    }
    cache.set(url, bytes);
    return bytes;
  };
}

// statSync 只在同步路径里用（sizeLookup 是同步语义，页面数量级在千以内）
import { statSync } from "node:fs";
function require_bytes(path) {
  return statSync(path).size;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limitKb = limitArg >= 0 ? Number(args[limitArg + 1]) || 300 : 300;
  const warnOnly = args.includes("--warn");

  if (!existsSync(join(DIST, "index.html"))) {
    console.error("✗ dist/ 里没有 index.html：先 npm run build");
    process.exit(2);
  }

  const pages = await listHtml(DIST);
  const entries = [];
  for (const page of pages) {
    const html = await readFile(page, "utf8");
    entries.push({ page: relative(DIST, page), urls: collectDownloadedImages(html) });
  }

  const sizeOf = sizeLookup();
  const violations = findOversized(entries, sizeOf, limitKb * 1024);

  if (violations.length === 0) {
    console.log(`✅ 图片预算通过：${pages.length} 页，没有被直接下载的 ${limitKb} KB 以上原图`);
    return;
  }

  console.error(`✗ 发现 ${violations.length} 处会被直接下载的大图（阈值 ${limitKb} KB）：`);
  for (const violation of violations.slice(0, 25)) {
    console.error(`  ${(violation.bytes / 1024).toFixed(0).padStart(6)} KB  ${violation.page}  ${violation.url.split("/").pop()}`);
  }
  if (violations.length > 25) console.error(`  …还有 ${violations.length - 25} 处`);
  console.error("\n修法：给封面/卡片换成 .thumb.webp / .hero.webp / .og.jpg，或把 <img> 放进带 webp <source> 的 <picture> 里。");
  if (!warnOnly) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
