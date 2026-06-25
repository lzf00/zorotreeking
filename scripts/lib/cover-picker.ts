/**
 * 从本站相册（public/photos/uploads/ + src/data/photo-manifest/）里选一张图，
 * 用作 digest 的封面图。
 *
 * 选图策略：
 *   - 用 date 做种子，**同一天选同一张**（多次重跑不抖）
 *   - 跳过宽高比明显竖向的图（cover 是横版）
 *   - 优先 webp，回退 jpeg
 *   - 找不到合适的图就返回 null（不阻塞 digest 主流程）
 *
 * 返回的 cover 是站内绝对路径（如 /photos/uploads/hudieren/xxx.webp），
 * 直接落进 frontmatter `cover:` 字段，Astro 静态站会随包发出去。
 *
 * 不再下载到 public/covers/。原 public/covers/ 留作 doubao seedream 失败兜底（已停用）。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST_DIR = path.join(ROOT, "src", "data", "photo-manifest");

type PhotoEntry = {
  src: string;
  srcWebp?: string;
  thumb?: string;
  thumbWebp?: string;
  width: number;
  height: number;
  alt?: string;
};

/** 把所有 album manifest 平铺成一个图池，且只保留横版图（宽高比 ≥ 1.2）。 */
async function loadAllHorizontalPhotos(): Promise<PhotoEntry[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(MANIFEST_DIR);
  } catch {
    return [];
  }
  const all: PhotoEntry[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    // 跳过样例
    if (f === "sample-album.json") continue;
    try {
      const txt = await fs.readFile(path.join(MANIFEST_DIR, f), "utf-8");
      const entries = JSON.parse(txt) as PhotoEntry[];
      for (const e of entries) {
        // 跳过没尺寸的
        if (!e.width || !e.height) continue;
        // 横版优先（≥ 1.2 宽高比）
        if (e.width / e.height < 1.2) continue;
        // 去重：同一张图 jpeg + webp 是两条记录，按文件名（去扩展）去重
        const base = (e.src || "").replace(/\.(jpe?g|png|webp)$/i, "");
        if (all.some((p) => (p.src || "").replace(/\.(jpe?g|png|webp)$/i, "") === base)) continue;
        all.push(e);
      }
    } catch (err) {
      console.warn(`[cover-picker] skip ${f}: ${(err as Error).message}`);
    }
  }
  return all;
}

/** 用日期字符串做种子的 djb2 哈希，让"同一天 → 同一张图"。 */
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 给一篇 digest 选一张相册图作 cover。
 *
 * @param seed 通常传 digest 日期（YYYY-MM-DD），同一篇 digest 多次重跑会选到同一张
 * @returns 站内路径如 "/photos/uploads/hudieren/xxx.jpeg"，或 null
 *
 * 兼容性：优先返回 jpg/png，回退 webp。OG 分享（微信/QQ/Telegram 部分版本）
 * 对 webp 兼容不佳，cover 用 jpg 最稳；站内显示 cover 时再用 srcWebp 节流。
 */
export async function pickCoverFromLibrary(seed: string): Promise<string | null> {
  const pool = await loadAllHorizontalPhotos();
  if (pool.length === 0) {
    console.warn("[cover-picker] photo library 是空的，跳过 cover");
    return null;
  }
  const idx = hashSeed(seed) % pool.length;
  const pick = pool[idx];
  // src 是 jpeg/png 原图；srcWebp 是 sharp 转的 webp
  return pick.src || pick.srcWebp || null;
}
