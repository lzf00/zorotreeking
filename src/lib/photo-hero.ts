/**
 * hero 大图的 webp 候选：手机用 720px 的 `.thumb.webp`（约 28 KB），桌面用原尺寸 webp（约 85 KB）。
 *
 * 之前手机上也会下 1536px 的整幅 webp：390×844 + 4× CPU + 1.6Mbps 下实测 LCP 1228ms，
 * 换成 720px 缩略图后 1008ms（−220ms）。两边的宽高比一致（3:2），所以不会引入 CLS。
 * 抽成函数是为了让测试能锁住「手机分支必须存在」这件事，而不是靠读 .astro 文件。
 */
import { buildSrcSet } from "@/lib/photo-srcset";

export type HeroCover =
  | {
      srcWebp?: string | null;
      thumbWebp?: string | null;
      thumbSm?: string | null;
      heroWebp?: string | null;
      midWebp?: string | null;
      width?: number;
    }
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

/**
 * hero 的 `srcset`：手机档只给 480/720，宽屏档给 720 和 1600（或原尺寸）。
 *
 * 为什么宽屏档也要带上 720：之前是「media 一刀切」——≤640 手机给缩略图，
 * 其余全部给大图。结果平板（768 CSS px）和 1x 小笔记本（1024 CSS px）都在下
 * 1600px 的 hero（hudieren 188 KB、mac1 119 KB），而它们实际只需要 ~768–1024 px。
 * 换成带描述符的 srcset 后浏览器自己算：768@1x 选 720w（28 KB），768@2x 选 1600w。
 */
export function heroSrcSets(cover?: HeroCover): { mobile: string; wide: string } {
  const w = cover?.width ?? 0;
  const thumb = cover?.thumbWebp
    ? [{ url: cover.thumbWebp, width: Math.min(720, w || 720) }]
    : [];
  const thumbSmall = cover?.thumbSm
    ? [{ url: cover.thumbSm, width: Math.min(480, w || 480) }]
    : [];
  const mid = cover?.midWebp
    ? [{ url: cover.midWebp, width: Math.min(1200, w || 1200) }]
    : [];
  const big = cover?.heroWebp
    ? [{ url: cover.heroWebp, width: Math.min(1600, w || 1600) }]
    : cover?.srcWebp
      ? [{ url: cover.srcWebp, width: w || 1600 }]
      : [];
  return {
    mobile: buildSrcSet([...thumbSmall, ...thumb]),
    wide: buildSrcSet([...thumbSmall, ...thumb, ...mid, ...big]),
  };
}
