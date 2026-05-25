// 把 src/data/photo-manifest/*.json 一次性静态导入，Vite build 期能识别
type Photo = {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  exif?: Record<string, unknown>;
};

const modules = import.meta.glob<{ default: Photo[] }>(
  "../data/photo-manifest/*.json",
  { eager: true },
);

const manifests: Record<string, Photo[]> = {};
for (const [path, mod] of Object.entries(modules)) {
  const name = path.split("/").pop()!.replace(/\.json$/, "");
  manifests[name] = mod.default;
}

export function loadPhotoManifest(name: string | undefined | null): Photo[] {
  if (!name) return [];
  return manifests[name] ?? manifests[decodeURIComponent(name)] ?? [];
}

/**
 * 从 entry.data 推断 manifest folder key。优先级：
 *   1. entry.data.photos[0] 的 URL（用户上传时实际落到的文件夹）
 *   2. entry.data.manifest（显式指定）
 *   3. entry.data.translationKey（默认约定）
 *
 * 这层间接关键：Decap media_folder 模板基于 translationKey 求值——但
 * translationKey 可能在用户编辑过程中被改过。文件已经落到旧的文件夹里，
 * 所以"哪个文件夹有图就显示哪个文件夹"才是稳健的。
 */
export function resolveAlbumKey(data: {
  photos?: unknown;
  manifest?: string;
  translationKey?: string;
}): string {
  const photos = data.photos;
  if (Array.isArray(photos) && photos.length > 0) {
    const first = photos[0];
    const url =
      typeof first === "string"
        ? first
        : first && typeof first === "object" && "image" in first
          ? (first as { image: string }).image
          : null;
    if (url) {
      const m = url.match(/\/photos\/uploads\/([^/]+)\//);
      if (m) return decodeURIComponent(m[1]);
    }
  }
  return data.manifest || data.translationKey || "";
}
