#!/usr/bin/env node
/**
 * 给日报列表页的封面图生成 640w / 960w 小图。
 *
 * 背景：`/invest/digest/` 的封面直接用了 OG 图（1200×630、~105KB），但卡片在桌面上
 * 只有 430px 宽，手机上是整行 350px——等于每个访客下载 2.5 倍的像素。这张封面还是
 * LCP 元素，所以它的大小直接决定 LCP。
 *
 * 归档页的封面都来自 `src/content/**` 的 `cover:`，指向 `/photos/uploads/...`（原图是
 * 照片站的 OG 图，不能原地缩小）。这里在旁边生成 `.w640.jpg` / `.w960.jpg`：
 * 文件已存在且比原图新就跳过，新日报加了新封面会自动补。
 *
 * 用法：node scripts/cover-variants.mjs [--check]
 *   --check 只检查缺哪些，不写文件（CI 的 prebuild 也能跑，缺 sharp 时跳过不报错）
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CONTENT_DIRS = ["src/content/invest"];
const PUBLIC = path.join(ROOT, "public");
const WIDTHS = [640, 960];
const CHECK_ONLY = process.argv.includes("--check");

/** 从 markdown frontmatter 里抠 cover（只认本站 /photos/ 路径，外链跳过）。 */
export function coverFromFrontmatter(source) {
  const match = /^cover:\s*["']?([^"'\n]+)["']?\s*$/m.exec(source);
  if (!match) return null;
  const value = match[1].trim();
  return value.startsWith("/photos/") ? value : null;
}

/** 封面 URL 里可能有 %20 这类转义（中文/空格文件名），读盘前要还原。 */
export function decodeCoverPath(cover) {
  try {
    return decodeURIComponent(cover);
  } catch {
    return cover;
  }
}

export function variantPath(cover, width) {
  // 封面既有 jpg/png，也有照片站新导出的 webp（两期日报就是 .webp）
  return cover.replace(/\.(jpe?g|png|webp|avif)$/i, `.w${width}.jpg`);
}

async function collectCovers() {
  const covers = new Set();
  for (const dir of CONTENT_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
      const cover = coverFromFrontmatter(await readFile(path.join(abs, entry.name), "utf8"));
      if (cover) covers.add(cover);
    }
  }
  return [...covers].sort();
}

async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export async function main() {
  const covers = await collectCovers();
  if (!covers.length) {
    console.log("[cover] 没有找到 /photos/ 封面，跳过");
    return;
  }

  const missing = [];
  for (const cover of covers) {
    const sourcePath = path.join(PUBLIC, decodeCoverPath(cover));
    const sourceInfo = await stat(sourcePath).catch(() => null);
    if (!sourceInfo) {
      console.warn(`[cover] 源图不存在，跳过：${cover}`);
      continue;
    }
    for (const width of WIDTHS) {
      const outPath = path.join(PUBLIC, decodeCoverPath(variantPath(cover, width)));
      const outInfo = await stat(outPath).catch(() => null);
      if (outInfo && outInfo.mtimeMs >= sourceInfo.mtimeMs) continue;
      missing.push({ cover, width, sourcePath, outPath });
    }
  }

  if (!missing.length) {
    console.log(`[cover] ${covers.length} 张封面、${covers.length * WIDTHS.length} 个尺寸都已最新`);
    return;
  }
  if (CHECK_ONLY) {
    console.log(`[cover] 缺 ${missing.length} 个变体：`);
    for (const item of missing.slice(0, 20)) console.log(`  ${item.cover} → ${variantPath(item.cover, item.width)}`);
    return;
  }

  const sharp = await loadSharp();
  if (!sharp) {
    console.warn(`[cover] 没装 sharp，跳过 ${missing.length} 个变体的生成（页面会自动回退到原图）`);
    return;
  }

  let written = 0;
  for (const item of missing) {
    await sharp(item.sourcePath).resize({ width: item.width, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(item.outPath);
    written += 1;
  }
  console.log(`[cover] 生成 ${written} 个变体（${covers.length} 张封面 × ${WIDTHS.join("/")}）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
