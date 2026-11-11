import fs from "node:fs";
import path from "node:path";

/**
 * 社交分享卡片（og:image）解析。
 *
 * 为什么要有这一层：2026-11 审计发现 42 个页面的 og:image 指向根本不存在的
 * 文件（英文投资日报有 40 篇是机器翻译出来的，翻译时还没补 cover，页面就落到
 * `/og/invest/<slug>.png` 这个只给少数文章生成过的路径上），还有 5 个页面拿
 * 3.6MB / 1080×2400 的原图当卡片——平台抓不到图或按 1200×630 硬裁，效果都很差。
 *
 * 规则：候选封面按顺序试，能用的条件是"public 里真的有这个文件"。
 *   1. 存在同名 `.og.jpg` 派生图（统一 1200×630）→ 用它
 *   2. 原始文件存在 → 用原图
 *   3. 全都不存在 → 站点默认卡，绝不再输出 404 图片地址
 */

const PUBLIC_DIR = path.join(process.cwd(), "public");
const DEFAULT_IMAGE = "/og-default.png";
/** 派生图统一尺寸，见 scripts（照片管线生成 .og.jpg 时固定 1200×630）。 */
export const OG_DERIVATIVE = { width: 1200, height: 630 } as const;

function isExternal(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith("//");
}

/** public/ 下是否真的存在这个静态资源（忽略 query，解码中文文件名）。 */
function hasAsset(src: string): boolean {
  if (!src || isExternal(src)) return false;
  try {
    const clean = decodeURIComponent(src.split("?")[0]);
    return fs.statSync(path.join(PUBLIC_DIR, clean)).isFile();
  } catch {
    return false;
  }
}

/** `/a/b.jpg` → `/a/b.og.jpg`，前提是派生图真的存在。 */
export function ogDerivative(src: string): string | null {
  const match = src.match(/^(.*)\.(jpe?g|png|webp|avif)$/i);
  if (!match) return null;
  const candidate = `${match[1]}.og.jpg`;
  return candidate !== src && hasAsset(candidate) ? candidate : null;
}

export interface SocialImage {
  src: string;
  width: number;
  height: number;
  /** 是否替调用方换过图（换过时宽高会被改成派生图尺寸）。 */
  substituted: boolean;
}

/**
 * 解析最终用于 og:image 的地址。
 *
 * @param candidates 候选封面，按优先级排列（可以含 undefined，会被跳过）
 * @param fallbackSize 原图尺寸（调用方知道时传，用于告诉平台别硬裁）
 */
export function resolveSocialImage(
  candidates: Array<string | undefined | null>,
  fallbackSize?: { width?: number; height?: number },
): SocialImage {
  for (const raw of candidates) {
    const src = raw?.trim();
    if (!src) continue;
    if (isExternal(src)) {
      return {
        src,
        width: fallbackSize?.width ?? OG_DERIVATIVE.width,
        height: fallbackSize?.height ?? OG_DERIVATIVE.height,
        substituted: false,
      };
    }
    const og = ogDerivative(src);
    if (og) return { src: og, ...OG_DERIVATIVE, substituted: true };
    if (hasAsset(src)) {
      return {
        src,
        width: fallbackSize?.width ?? OG_DERIVATIVE.width,
        height: fallbackSize?.height ?? OG_DERIVATIVE.height,
        substituted: false,
      };
    }
  }
  return { src: DEFAULT_IMAGE, ...OG_DERIVATIVE, substituted: true };
}

/** 同一篇稿子的另一种语言版本可能带着封面，译文缺 cover 时借过来。 */
export function coverByTranslationKey(
  entries: Array<{ data: { translationKey?: string; cover?: string | null } }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.data.translationKey;
    const cover = entry.data.cover;
    if (key && cover && !map.has(key)) map.set(key, cover);
  }
  return map;
}
