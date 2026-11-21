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
  srcOg?: string;          // 1200×630 og 专用尺寸（性能优化）
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
        // 横版优先（第 111 轮从 ≥1.2 放宽到 ≥1.0）：池子只有 40 张而 digest 有 680 篇，
        // 卡片的 object-cover 本来就会裁切，方形图完全能用，多一张就少几十次重复。
        if (e.width / e.height < 1.0) continue;
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
 * 选图索引（第 111 轮）。
 *
 * 旧实现是 `hashSeed(date) % pool.length` —— 看似随机，实际有两个毛病：
 *  1. 池子会随时间变大（先只有 2 张，后来补到 40 张），于是**早期生成的 630 篇 digest
 *     永远锁在 2 张封面上**，归档页翻两屏就是同一张图来回出现；
 *  2. 哈希分布不均，相邻日期可能连续撞同一张。
 *
 * 新规则：日期 → 距 1970 的天数 → 对池子取模。这样在池子大小不变时是**等距铺开**的，
 * 相邻两天必然不同（池子 > 1），同一天重跑仍然稳定，也不需要额外状态。
 */
export function pickIndex(seed: string, poolSize: number): number {
  if (poolSize <= 0) return -1;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(seed);
  if (iso) {
    const days = Math.floor(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86_400_000);
    // 乘一个与池子大小互质的步长再取模：既铺满整个池子（池子 40 张时 40 天走完一圈），
    // 又让相邻两天的封面看起来毫不相干 —— 直接取 days % 池子会让归档页按文件名顺序
    // 一张张往下排（baokemeng-19、-18、-17…），像系统生成而不是选的。
    let stride = 17;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    while (gcd(stride, poolSize) !== 1 && stride > 1) stride--;
    return (((days * stride) % poolSize) + poolSize) % poolSize;
  }
  return hashSeed(seed) % poolSize;
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
  const idx = pickIndex(seed, pool.length);
  const pick = pool[idx];
  // 优先 1200×630 og 专用尺寸（jpg ~80KB，社交分享最稳）
  // 回退原图 jpg（3-4MB，慢但保底）→ webp（webp 在微信/QQ 部分版本不预览）
  return pick.srcOg || pick.src || pick.srcWebp || null;
}
