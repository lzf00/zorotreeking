import { existsSync } from "node:fs";

/**
 * 内容卡片封面 → 最轻的可用派生图。
 *
 * 痛点：content 的 `cover` 字段经常直接指向照片原图（实测有 3741 KB 的 JPEG 和 903 KB 的
 * 原尺寸 webp），而卡片只有 400–900px 宽。这类卡片自己不会报错，Lighthouse 也量不到，
 * 只能靠翻首页/归档页的网络面板才发现。
 *
 * 规则：派生图存在就用派生图，否则退回原图（绝不 404）。优先级按「体积从轻到重」：
 * `.thumb.webp`（720px）→ `.w640.jpg` → `.w960.jpg` → `.og.jpg`（1200×630）→ 原图。
 */
export type CoverExists = (url: string) => boolean;

const DERIVED_SUFFIXES = [".thumb.webp", ".w640.jpg", ".w960.jpg", ".og.jpg"] as const;

/**
 * 已经是派生图的文件名（`.thumb.webp` / `.w640.jpg` / `.w960.jpg` / `.og.jpg` …）。
 *
 * 为什么需要：有 666 篇内容的 `cover:` 直接写成了派生图（多半是分享图 `.og.jpg`，
 * 1200×630、9.8 KB 起），以前 `coverStem` 只会剥掉最后的扩展名，于是候选变成
 * `xxx.og.thumb.webp` 这种不存在的路径，最终原样返回 `.og.jpg`——卡片用着最大的那张。
 * 正确做法是先剥派生后缀回到 stem，再按体积从轻到重挑。
 */
const DERIVED_RE = /\.(?:thumb480|thumb|mid|hero|w640|w960|og)\.(?:webp|jpe?g|png|avif)$/i;

/** 去掉扩展名：`/photos/x/foo.webp` → `/photos/x/foo`；`x/foo.og.jpg` 也归到 `x/foo` */
export function coverStem(cover: string | undefined | null): string | null {
  if (!cover || !cover.startsWith("/photos/")) return null;
  // 先剥派生后缀（`.og.jpg`），再剥普通扩展名，否则 `foo.og.jpg` 会变成 `foo.og`
  const stripped = cover.replace(DERIVED_RE, "");
  const match = stripped.match(/^(.*)\.(jpe?g|png|webp|avif)$/i);
  return match ? match[1] : stripped;
}

/** 候选派生图（不含原图），按优先级排列 */
export function derivedCandidates(cover: string | undefined | null): string[] {
  const stem = coverStem(cover);
  if (!stem) return [];
  return DERIVED_SUFFIXES.map((suffix) => `${stem}${suffix}`);
}

/**
 * 纯函数版本：`exists` 由调用方注入，方便测试。
 * 返回最终要用的 src（即便一个派生图都没有，也返回原图，而不是空串）。
 */
export function pickLightCover(cover: string | undefined | null, exists: CoverExists): string | undefined {
  if (!cover) return undefined;
  for (const candidate of derivedCandidates(cover)) {
    if (exists(candidate)) return candidate;
  }
  return cover;
}

/** 走磁盘的薄封装（Astro 页面里用）。文件名可能带空格/中文，读盘前要 decode。 */
export function lightCover(cover: string | undefined | null): string | undefined {
  return pickLightCover(cover, (url) => existsSync(`public${decodeURIComponent(url)}`));
}
