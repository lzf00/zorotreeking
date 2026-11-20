/**
 * 派生图的 srcset 组装。
 *
 * 两个坑（都是第 51–53 轮踩到的）：
 *  1. `<source srcset="/x.webp">` 不带宽度描述符时浏览器当成「1x 单候选」直接下载，
 *     `media` 命中就必然拉大图 —— 相册索引页桌面端因此常驻拉 1600px hero（188 KB），
 *     而卡片只有 ~576 CSS px。
 *  2. 描述符必须写**真实**宽度：原图只有 600px 时不能把缩略图标成 720w，
 *     否则浏览器会在 1x 屏上也选它（选了更大的图，白下载）。
 */

export type Variant = {
  /** 可能为空（该变体没生成） */
  url?: string | null;
  /** 这张图真实像素宽 */
  width: number;
};

/** 把候选变体拼成 `srcset` 字符串；同一 URL 只保留一次，按宽度升序 */
export function buildSrcSet(variants: Variant[]): string {
  const seen = new Map<string, number>();
  for (const v of variants) {
    if (!v.url || !Number.isFinite(v.width) || v.width <= 0) continue;
    const prev = seen.get(v.url);
    if (prev === undefined || v.width > prev) seen.set(v.url, Math.round(v.width));
  }
  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([url, width]) => `${url} ${width}w`)
    .join(", ");
}

/** 相册网格的单张照片：480w / 720w 两档 */
export function galleryVariants(p: {
  thumbWebp?: string | null;
  thumbSm?: string | null;
  width?: number;
}): Variant[] {
  const w = p.width ?? 0;
  return [
    { url: p.thumbSm, width: Math.min(480, w || 480) },
    { url: p.thumbWebp, width: Math.min(720, w || 720) },
  ];
}

/** 封面大图：480w / 720w / hero（1600w 或原宽）三档 */
export function coverVariants(cover: {
  thumbSm?: string | null;
  thumbWebp?: string | null;
  midWebp?: string | null;
  heroWebp?: string | null;
  srcWebp?: string | null;
  width?: number;
}): Variant[] {
  const w = cover.width ?? 0;
  const bigUrl = cover.heroWebp ?? cover.srcWebp;
  return [
    { url: cover.thumbSm, width: Math.min(480, w || 480) },
    { url: cover.thumbWebp, width: Math.min(720, w || 720) },
    // 1200w 中间档：平板 1x、2x 桌面卡片都在这一段，缺了就只能拉 1600
    { url: cover.midWebp, width: Math.min(1200, w || 1200) },
    { url: bigUrl, width: cover.heroWebp ? Math.min(1600, w || 1600) : w || 1600 },
  ];
}
