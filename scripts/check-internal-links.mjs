#!/usr/bin/env node
/**
 * 站内链接自检：扫 `dist/` 里的 HTML，确认每个站内 href/src 在产物里真的存在。
 *
 * 为什么不用线上爬虫：线上检查要打 1190 个请求（第 50 轮实测全部 200，耗时约 2 分钟），
 * 适合人工偶尔跑一次；而「改了内容/改了图片路径导致链接断掉」这类错，本地 dist 就能查出来，
 * 而且带确定性——塞进 gate 也不会引狼入室（不依赖网络、不依赖部署）。
 *
 * 用法：
 *   node scripts/check-internal-links.mjs            # 报告，有断链退出 1
 *   node scripts/check-internal-links.mjs --warn     # 只警告，退出 0
 *   node scripts/check-internal-links.mjs --limit 20 # 每类最多打印多少条
 *   node scripts/check-internal-links.mjs --dist .tmp # 检查指定产物目录（测试用）
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const distIdx = args.indexOf("--dist");
const DIST = distIdx >= 0
  ? path.resolve(process.cwd(), args[distIdx + 1])
  : path.resolve(import.meta.dirname, "..", "dist");
const warnOnly = args.includes("--warn");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 20 : 20;

/** 站内资源常带 ?v= / #frag，比对磁盘前要剥掉 */
function stripQuery(u) {
  return u.split("#")[0].split("?")[0];
}

/** 把站内路径映射成 dist 里的文件路径；返回 null 表示不该检查（外链/协议/纯锚点） */
function toDiskPath(raw) {
  if (!raw) return null;
  const u = raw.trim();
  if (!u || u.startsWith("#")) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u)) return null; // 外链、mailto:、data:
  if (!u.startsWith("/")) return null; // 相对路径（本站一律绝对路径，忽略）
  const clean = stripQuery(u);
  const rel = decodeURIComponent(clean).replace(/^\/+/, "");
  if (rel === "" || clean.endsWith("/")) return path.join(DIST, rel, "index.html");
  // 形如 /photo/baokemeng（无尾斜杠）站点会 301 到带斜杠版本，产物里是目录
  return path.join(DIST, rel);
}

function extract(html) {
  const links = new Set();
  const assets = new Set();
  for (const m of html.matchAll(/\shref="([^"]*)"/g)) links.add(m[1]);
  for (const m of html.matchAll(/\ssrc="([^"]*)"/g)) assets.add(m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) assets.add(url);
    }
  }
  // <link rel=preload as=image imagesrcset> 之类也顺手看一眼
  for (const m of html.matchAll(/\simagesrcset="([^"]*)"/g)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) assets.add(url);
    }
  }
  return { links, assets };
}

async function exists(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

const htmlFiles = (await readdir(DIST, { recursive: true })).filter((f) => f.endsWith(".html"));
if (htmlFiles.length === 0) {
  console.error(`✗ ${DIST} 里没有 HTML，先跑 npm run build`);
  process.exit(1);
}

const brokenLinks = new Map(); // target -> Set(引用页面)
const brokenAssets = new Map();
const cache = new Map();

async function check(target) {
  const disk = toDiskPath(target);
  if (!disk) return true;
  if (cache.has(disk)) return cache.get(disk);
  const ok = await exists(disk);
  cache.set(disk, ok);
  return ok;
}

for (const file of htmlFiles) {
  const html = await readFile(path.join(DIST, file), "utf8");
  const pageUrl = "/" + file.replace(/index\.html$/, "");
  const { links, assets } = extract(html);
  for (const [bucket, set] of [
    [brokenLinks, links],
    [brokenAssets, assets],
  ]) {
    for (const target of set) {
      if (await check(target)) continue;
      if (!bucket.has(target)) bucket.set(target, new Set());
      bucket.get(target).add(pageUrl);
    }
  }
}

const report = (label, map) => {
  if (map.size === 0) return false;
  console.log(`\n✗ ${label}：${map.size} 个目标不存在`);
  for (const [target, pages] of [...map.entries()].slice(0, LIMIT)) {
    const sample = [...pages].slice(0, 2).join(", ");
    console.log(`  ${target}  ← ${pages.size} 处引用（如 ${sample}）`);
  }
  if (map.size > LIMIT) console.log(`  …其余 ${map.size - LIMIT} 个省略`);
  return true;
};

const badLinks = report("站内链接", brokenLinks);
const badAssets = report("站内资源（图片/脚本/样式）", brokenAssets);

if (!badLinks && !badAssets) {
  console.log(`✓ 站内链接自检通过：${htmlFiles.length} 个页面，${cache.size} 个目标全部存在`);
  process.exit(0);
}
process.exit(warnOnly ? 0 : 1);
