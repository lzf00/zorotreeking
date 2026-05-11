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

export function loadPhotoManifest(name: string): Photo[] {
  return manifests[name] ?? [];
}
