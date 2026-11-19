/**
 * hero 大图的 webp 候选：手机用 720px 的 `.thumb.webp`（约 28 KB），桌面用原尺寸 webp（约 85 KB）。
 *
 * 之前手机上也会下 1536px 的整幅 webp：390×844 + 4× CPU + 1.6Mbps 下实测 LCP 1228ms，
 * 换成 720px 缩略图后 1008ms（−220ms）。两边的宽高比一致（3:2），所以不会引入 CLS。
 * 抽成函数是为了让测试能锁住「手机分支必须存在」这件事，而不是靠读 .astro 文件。
 */
export type HeroCover =
  | { srcWebp?: string | null; thumbWebp?: string | null; heroWebp?: string | null }
  | null
  | undefined;

export function heroWebpSources(cover?: HeroCover): {
  mobile: string | null;
  desktop: string | null;
} {
  return {
    mobile: cover?.thumbWebp ?? null,
    // 优先 1600px 的 hero 变体：原尺寸 webp 在 3840×2160 的照片上有 903 KB，
    // 而 hero 最多只按 1280 CSS px 显示。
    desktop: cover?.heroWebp ?? cover?.srcWebp ?? null,
  };
}
