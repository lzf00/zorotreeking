import type { Photo } from "@/lib/photo-manifests";

/**
 * 相册页「封面那张图」的选法：frontmatter.cover 优先，找不到对应 manifest 条目时
 * 退化成裸路径；没有 cover 字段就用第一张。
 *
 * 抽成函数的原因：中英文相册页各写过一份，英文那份漏了 frontmatter.cover，
 * 结果同一本相册中英文首图不同、英文首图还多下了 76 KB（第 52 轮实测）。
 * 这类「两个页面模板慢慢漂移」的问题只能靠共用函数 + 测试挡住。
 */
const sameFile = (a?: string | null, b?: string | null) =>
  !!a && !!b && normalize(a) === normalize(b);

/** manifest 里的 URL 是编码过的（文件名含空格时 srcset 必须编码），frontmatter 写的是原始路径 */
function normalize(url: string) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

export function pickAlbumCover(
  coverPath: string | null | undefined,
  photos: Photo[],
  title = "",
): { cover: Photo | null; rest: Photo[] } {
  if (photos.length === 0) return { cover: null, rest: [] };
  if (!coverPath) return { cover: photos[0], rest: photos.slice(1) };

  const hit = photos.find((p) => sameFile(p.src, coverPath) || sameFile(p.thumb, coverPath));
  if (!hit) {
    // cover 指向 manifest 之外的图（手写路径 / 新传的图还没进 manifest）
    return {
      cover: { src: coverPath, thumb: coverPath, alt: title, width: 0, height: 0 },
      rest: photos,
    };
  }
  // 用 src 比对而不是下标：cover 可能是第二张、第三张
  return { cover: hit, rest: photos.filter((p) => p.src !== hit.src) };
}
