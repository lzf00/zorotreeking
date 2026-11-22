/**
 * 构建期照片 manifest 生成器
 *
 * 扫描 `public/photos/uploads/<album-slug>/*` 下每张图：
 *   - sharp 测尺寸（用于 PhotoSwipe 等比缩放）
 *   - exifr 抽元数据（相机/光圈/快门/ISO/焦段/拍摄时间）
 *   - 输出 src/data/photo-manifest/<album-slug>.json
 *
 * 已存在但无对应上传子目录的 manifest（如 sample-album.json）不会被动。
 * 这样原图(在线上传) 和 占位图/picsum(示例) 可以并存。
 *
 * 触发：
 *   - 手动：npx tsx scripts/build-photo-manifests.ts
 *   - 自动：deploy.yml 在 npm run build 之前调用
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPLOADS_DIR = path.join(ROOT, "public", "photos", "uploads");
const MANIFEST_DIR = path.join(ROOT, "src", "data", "photo-manifest");

const IMAGE_RE = /\.(jpe?g|png|webp|avif)$/i;

const photoUrl = (albumSlug: string, fileName: string) =>
  // 文件名里常有空格 / 中文 / 括号：srcset 用空格分隔候选图，
  // 未编码的 URL 会被整体丢弃，浏览器退回 <img src> 拉原图。
  encodeURI(`/photos/uploads/${albumSlug}/${fileName}`);

type PhotoEntry = {
  src: string;
  srcWebp?: string;       // 同图 .webp 版本（sharp 生成，质量 80，体积通常 -40%）
  srcOg?: string;         // 1200×630 OG 专用尺寸 jpg（社交分享专用，原图 3-4MB 不能直接用作 og:image）
  thumb: string;
  thumbWebp?: string;
  /** 480w 缩略图（窄屏/1x 屏用，比 720w 小约 40%） */
  thumbSm?: string;
  /** 1200w 中间档：平板 1x、2x 桌面卡片、相册首图都卡在 720 与 1600 之间 */
  midWebp?: string;
  /** hero 用的 1600px 宽 webp（原图更宽时才生成）；相册封面在 1280 宽屏上显示 */
  heroWebp?: string;
  width: number;
  height: number;
  /** 中文 alt：相册名 + 地点 + 月份 + 序号（原来是文件名，读屏会念出 "13408098752635440"） */
  alt: string;
  /** 英文 alt：同结构，给 /en/photo/ 用 */
  altEn?: string;
  /** GPS 坐标（WGS84）；从 EXIF GPSLatitude/Longitude 取，无则 undefined */
  lat?: number;
  lng?: number;
  exif?: {
    camera?: string;
    lens?: string;
    iso?: number;
    aperture?: number;
    shutter?: string;
    focal?: number;
    takenAt?: string;
  };
};

const CONTENT_DIR = path.join(ROOT, "src", "content", "photo");

type AlbumMeta = {
  title?: string;
  location?: string;
  date?: string;
};

/**
 * 相册文件夹名 → 内容文件。两者不总是一致：`photos/uploads/mac1/` 对的是
 * `src/content/photo/123.<lang>.mdx`（`translationKey: mac1`）。
 *
 * 只按文件夹名找文件时，这类相册的 alt 会退化成「第 1 张，共 6 张」——标题、地点、
 * 时间全都丢了（第 170 轮实测 /photo/mac1/ 与 /en/photo/mac1/ 共 12 张）。
 * 找不到同名文件时，再按 frontmatter 的 `translationKey` 反查一次。
 */
async function resolveAlbumFile(albumSlug: string, lang: "zh" | "en"): Promise<string | null> {
  const direct = path.join(CONTENT_DIR, `${albumSlug}.${lang}.mdx`);
  try {
    await fs.access(direct);
    return direct;
  } catch {
    // 继续按 translationKey 找
  }
  let files: string[] = [];
  try {
    files = await fs.readdir(CONTENT_DIR);
  } catch {
    return null;
  }
  for (const file of files) {
    if (!file.endsWith(`.${lang}.mdx`)) continue;
    const full = path.join(CONTENT_DIR, file);
    const raw = await fs.readFile(full, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!match) continue;
    const key = /^translationKey:\s*(.+)$/m.exec(match[1])?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (key === albumSlug) return full;
  }
  return null;
}

/** 读 `src/content/photo/<slug>.<lang>.mdx` 的 frontmatter（只取 alt 需要的三个字段）。 */
async function readAlbumMeta(albumSlug: string, lang: "zh" | "en"): Promise<AlbumMeta | null> {
  const file = await resolveAlbumFile(albumSlug, lang);
  if (!file) return null;
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return null;
  try {
    const { parse } = await import("yaml");
    const data = parse(match[1]) as Record<string, unknown>;
    return {
      title: typeof data.title === "string" ? data.title : undefined,
      location: typeof data.location === "string" ? data.location : undefined,
      date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : typeof data.date === "string" ? data.date : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 组装 alt。原则：读屏用户听到的应该是「哪一本相册的第几张、在哪、什么时候」，
 * 而不是 `13408098752635440` 这种相机文件名。
 * 有相册元信息就用，没有就退化成「第 N 张照片」——绝不退回文件名。
 */
function buildAlt(meta: AlbumMeta | null, index: number, total: number, lang: "zh" | "en"): string {
  const parts: string[] = [];
  if (meta?.title) parts.push(meta.title);
  if (meta?.location) parts.push(meta.location);
  if (meta?.date) {
    const [year, month] = meta.date.split("-");
    parts.push(lang === "en" ? `${month}/${year}` : `${year} 年 ${Number(month)} 月`);
  }
  const counter = lang === "en" ? `photo ${index} of ${total}` : `第 ${index} 张，共 ${total} 张`;
  const head = parts.filter(Boolean).join(" · ");
  return head ? `${head} · ${counter}` : counter;
}

function formatShutter(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return "";
  return t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}`;
}

async function main() {
  // 仅当 uploads 目录存在时才工作；不存在直接跳过（首次部署或没相册的情况）
  try {
    const stat = await fs.stat(UPLOADS_DIR);
    if (!stat.isDirectory()) return;
  } catch {
    console.log("[photo-manifests] no uploads dir, skip.");
    return;
  }

  const sharpMod = await import("sharp").catch(() => null);
  const exifrMod = await import("exifr").catch(() => null);
  const sharp = sharpMod?.default;
  const exifr = (exifrMod as any)?.default ?? exifrMod;
  if (!sharp) console.warn("[photo-manifests] sharp missing; manifest will lack dimensions.");

  await fs.mkdir(MANIFEST_DIR, { recursive: true });

  const subdirs = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
  let albumCount = 0;
  let photoCount = 0;

  for (const ent of subdirs) {
    if (!ent.isDirectory()) continue;
    const albumSlug = ent.name;
    const albumDir = path.join(UPLOADS_DIR, albumSlug);

    // 过滤：跳过脚本自身生成的派生文件（.og.jpg / .webp 已有对应原图时）
    // 派生文件规则：xxx.og.jpg 对应原图 xxx.<ext>；xxx.webp 通常也是派生（除非孤立无原图）
    const rawFiles = (await fs.readdir(albumDir)).filter((f) => IMAGE_RE.test(f)).sort();
    const files: string[] = [];
    for (const f of rawFiles) {
      // xxx.og.jpg 一律跳过（永远是派生）
      if (/\.og\.jpg$/i.test(f)) continue;
      // xxx.thumb.webp 一律跳过（网格缩略图，永远是派生）
      if (/\.thumb\.webp$/i.test(f)) continue;
      // xxx.hero.webp 一律跳过（1600px 的 hero 变体，第 41 轮加的）。
      // 这里如果漏了，派生文件会被当成一张新照片塞进 manifest，而且 `xxx.hero.webp`
      // 按字典序排在 `xxx.jpeg` 前面 → 直接顶掉封面。第 43 轮踩过。
      if (/\.hero\.webp$/i.test(f)) continue;
      // xxx.w640.jpg / xxx.w960.jpg 跳过（日报列表页封面变体，scripts/cover-variants.mjs 生成）
      if (/\.w(?:640|960)\.jpg$/i.test(f)) continue;
      // 派生变体的「派生」：本地试验遗留过 .og.w640.webp / .w960.webp 这类文件，
      // 上面按后缀过滤抓不到它们，于是被当成新照片塞进 manifest——线上页面会为同一张图
      // 多下 1-2 份（第 49 轮在本地复现）。只要文件名里带这些派生段，一律跳过。
      if (/\.(?:og|thumb\d*|hero|mid)\./i.test(f) || /\.w(?:640|960)\./i.test(f)) continue;
      // xxx.webp：如果同目录有 xxx.jpg/jpeg/png 原图，则跳过（派生）；否则保留（孤立 webp 当原图）
      if (/\.webp$/i.test(f)) {
        const base = f.replace(/\.webp$/i, "");
        const hasSourceOriginal = rawFiles.some((g) =>
          g === `${base}.jpg` || g === `${base}.jpeg` || g === `${base}.png`
        );
        if (hasSourceOriginal) continue;
      }
      files.push(f);
    }
    if (files.length === 0) continue;

    const metaZh = await readAlbumMeta(albumSlug, "zh");
    const metaEn = await readAlbumMeta(albumSlug, "en");
    const total = files.length;

    const entries: PhotoEntry[] = [];
    for (const [index, f] of files.entries()) {
      const inputPath = path.join(albumDir, f);
      const buf = await fs.readFile(inputPath);

      let width = 0;
      let height = 0;
      let webpRelative: string | undefined;
      let ogRelative: string | undefined;
      let thumbRelative: string | undefined;
      let thumbSmRelative: string | undefined;
      let heroRelative: string | undefined;
      let midRelative: string | undefined;
      if (sharp) {
        try {
          const meta = await sharp(buf).rotate().metadata();
          width = meta.width || 0;
          height = meta.height || 0;
        } catch (e) {
          console.warn(`[photo-manifests] ${albumSlug}/${f}: sharp failed`, e);
        }

        // 生成 .webp（增量：已存在且 mtime 比原图新就跳过）
        const ext = path.extname(f);
        // .webp 上传（Decap 直接拖 webp、或外部工具导出）本身就是最终格式，不用再转一次。
        // 但派生图（缩略图 / hero / og）原先全写在这个 jpg/png 分支里，导致 webp 原图
        // 一张派生图都拿不到：相册网格用 123 KB 全图填 413px 的格子（第 52 轮发现）。
        const isRasterSource = /\.(?:jpe?g|png)$/i.test(f);
        let webpName: string;
        if (isRasterSource) {
          webpName = path.basename(f, ext) + ".webp";
          const webpPath = path.join(albumDir, webpName);
          let needGen = true;
          try {
            const srcStat = await fs.stat(inputPath);
            const webpStat = await fs.stat(webpPath);
            if (webpStat.mtimeMs >= srcStat.mtimeMs) needGen = false;
          } catch {
            /* webp 不存在 → 生成 */
          }
          if (needGen) {
            try {
              await sharp(buf).rotate().webp({ quality: 80 }).toFile(webpPath);
              console.log(`    + ${webpName}`);
            } catch (e) {
              console.warn(`    ✗ webp gen failed ${webpName}:`, e);
            }
          }
        } else {
          // 原图就是 webp：直接拿它当 srcWebp
          webpName = f;
        }
        webpRelative = photoUrl(albumSlug, webpName);
        {
          // 网格缩略图：相册页一次滚到底要拉全部图，原先用的是全尺寸 webp
          // （1920px、平均 34KB、最大 604KB），一页 1.7MB。三列布局每格
          // 实际显示宽度 ~400px，2x 屏 800px 足够，缩到 720px 基本无感。
          // 原图宽度本来就 ≤720 的不再生成，直接用全尺寸 webp 充当缩略图。
          //
          // 质量 74：第 49 轮把相册网格的第一屏两张缩略图量出来是 66 KB + 57 KB（q78），
          // 降到 74 后视觉上几乎无差，但首屏能少几十 KB。
          // ⚠️ 改了质量常量必须跑 `npm run clean:derived` 再 build —— 下面的 mtime 守卫
          // 会因为「缩略图比原图新」而跳过已经存在的旧质量文件。
          if (width > 720) {
            const thumbName = path.basename(f, ext) + ".thumb.webp";
            const thumbPath = path.join(albumDir, thumbName);
            let needThumb = true;
            try {
              const srcStat = await fs.stat(inputPath);
              const thumbStat = await fs.stat(thumbPath);
              if (thumbStat.mtimeMs >= srcStat.mtimeMs) needThumb = false;
            } catch {
              /* 不存在 → 生成 */
            }
            if (needThumb) {
              try {
                await sharp(buf).rotate().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 74 }).toFile(thumbPath);
                console.log(`    + ${thumbName}`);
              } catch (e) {
                console.warn(`    ✗ thumb gen failed ${thumbName}:`, e);
              }
            }
            thumbRelative = photoUrl(albumSlug, thumbName);
          }

          // 480w 小缩略图：桌面三列每格 ~400 CSS px、手机 1x 屏 ~390 px，
          // 都用不到 720w。配上 srcset 后这些场景能省四成流量；2x 屏仍按 720 取。
          if (width > 480) {
            const thumbSmName = path.basename(f, ext) + ".thumb480.webp";
            const thumbSmPath = path.join(albumDir, thumbSmName);
            let needThumbSm = true;
            try {
              const srcStat = await fs.stat(inputPath);
              const thumbSmStat = await fs.stat(thumbSmPath);
              if (thumbSmStat.mtimeMs >= srcStat.mtimeMs) needThumbSm = false;
            } catch {
              /* 不存在 → 生成 */
            }
            if (needThumbSm) {
              try {
                await sharp(buf).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 74 }).toFile(thumbSmPath);
                console.log(`    + ${thumbSmName}`);
              } catch (e) {
                console.warn(`    ✗ thumb480 gen failed ${thumbSmName}:`, e);
              }
            }
            thumbSmRelative = photoUrl(albumSlug, thumbSmName);
          }

          // 1200w 中间档（第 54 轮）：720 和 1600 之间是个大空档——平板 1x（768）
          // 和 2x 桌面卡片（1152）都只能二选一：要么 720 糊，要么 1600 多传一倍。
          // 实测 hudieren 首图 188 KB → 约 100 KB，索引页 2x 桌面 317 KB → 约 150 KB。
          //
          // 第 59 轮把门槛从 >1200 放到 >1000：1080px 这一档照片（mac1 全册）之前既没有
          // hero 也没有 mid，首图只能拿 q80 的 121 KB 原尺寸 webp。mid 用 withoutEnlargement，
          // 1080 的原图就停在 1080，只降质量（q76），同尺寸下小 30% 左右。
          if (width > 1000) {
            const midName = path.basename(f, ext) + ".mid.webp";
            const midPath = path.join(albumDir, midName);
            let needMid = true;
            try {
              const srcStat = await fs.stat(inputPath);
              const midStat = await fs.stat(midPath);
              if (midStat.mtimeMs >= srcStat.mtimeMs) needMid = false;
            } catch {
              /* 不存在 → 生成 */
            }
            if (needMid) {
              try {
                await sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 76 }).toFile(midPath);
                console.log(`    + ${midName} (mid 1200w)`);
              } catch (e) {
                console.warn(`    ✗ mid gen failed ${midName}:`, e);
              }
            }
            midRelative = photoUrl(albumSlug, midName);
          }

          // hero 专用：相册封面/详情页顶部那张图，1280 宽屏最多显示 ~1280 CSS px。
          // 原尺寸 webp（质量 80）会把 3840×2160 的照片压成 903 KB——整页最重的一笔。
          // 缩到 1600px 宽（2x 屏 800 CSS px 也够），实测 3840×2160 的 903 KB → 约 180 KB。
          // 阈值从 1600 降到 1200（第 52 轮）：1200–1600px 的照片原本没有 hero 变体，
          // 详情页首图只能拉 q80 全尺寸 webp（mac1 那张 119 KB），重编码到 q78 约 90 KB。
          if (width > 1200) {
            const heroName = path.basename(f, ext) + ".hero.webp";
            const heroPath = path.join(albumDir, heroName);
            let needHero = true;
            try {
              const srcStat = await fs.stat(inputPath);
              const heroStat = await fs.stat(heroPath);
              if (heroStat.mtimeMs >= srcStat.mtimeMs) needHero = false;
            } catch {
              /* 不存在 → 生成 */
            }
            if (needHero) {
              try {
                await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(heroPath);
                console.log(`    + ${heroName} (hero 1600w)`);
              } catch (e) {
                console.warn(`    ✗ hero gen failed ${heroName}:`, e);
              }
            }
            heroRelative = photoUrl(albumSlug, heroName);
          }

          // 生成 1200×630 OG 专用尺寸（jpg，cover fit，质量 82，社交分享专用）
          // 原来只给横版（宽 ≥ 高 × 1.2）生成，结果竖版照片当相册封面时只能拿原图
          // 去当分享卡（1080×2400 会被平台横裁成一条）。竖版也生成一份 cover 裁切版本：
          // 数量少（整站 60 张照片里约 20 张竖版），体积可控，卡片比例才对。
          if (width >= 1000 && height > 0) {
            const ogName = path.basename(f, ext) + ".og.jpg";
            const ogPath = path.join(albumDir, ogName);
            let needOgGen = true;
            try {
              const srcStat = await fs.stat(inputPath);
              const ogStat = await fs.stat(ogPath);
              if (ogStat.mtimeMs >= srcStat.mtimeMs) needOgGen = false;
            } catch { /* og 不存在 → 生成 */ }
            if (needOgGen) {
              try {
                await sharp(buf)
                  .rotate()
                  .resize(1200, 630, { fit: "cover", position: "attention" })
                  .jpeg({ quality: 82, mozjpeg: true })
                  .toFile(ogPath);
                console.log(`    + ${ogName} (og 1200×630)`);
              } catch (e) {
                console.warn(`    ✗ og gen failed ${ogName}:`, e);
              }
            }
            ogRelative = photoUrl(albumSlug, ogName);
          }
        }
      }

      let exifData: any = {};
      let gpsData: any = null;
      if (exifr) {
        try {
          exifData = await exifr.parse(buf, {
            pick: ["Make", "Model", "LensModel", "ISO", "FNumber", "ExposureTime", "FocalLength", "DateTimeOriginal"],
          }) || {};
        } catch {
          // 部分文件可能没 EXIF，忽略
        }
        // GPS 单独抽（exifr.gps 返回 { latitude, longitude }，自动处理 N/S/E/W）
        try {
          gpsData = await exifr.gps(buf);
        } catch {
          // 没 GPS 忽略
        }
      }

      entries.push({
        src: photoUrl(albumSlug, f),
        srcWebp: webpRelative,
        srcOg: ogRelative,
        thumb: photoUrl(albumSlug, f),
        thumbWebp: thumbRelative ?? webpRelative,
        thumbSm: thumbSmRelative,
        heroWebp: heroRelative,
        midWebp: midRelative,
        width,
        height,
        alt: buildAlt(metaZh, index + 1, total, "zh"),
        // 没有英文 meta 时也要给一句英文 alt：退回中文会让英文页的 alt 变成
        // "第 1 张，共 6 张"（第 168 轮在 /en/photo/mac1/ 实测到）
        altEn: buildAlt(metaEn, index + 1, total, "en"),
        lat: gpsData?.latitude,
        lng: gpsData?.longitude,
        exif: {
          camera: exifData?.Make && exifData?.Model ? `${exifData.Make} ${exifData.Model}`.trim() : exifData?.Model,
          lens: exifData?.LensModel,
          iso: exifData?.ISO,
          aperture: exifData?.FNumber,
          shutter: exifData?.ExposureTime ? formatShutter(exifData.ExposureTime) : undefined,
          focal: exifData?.FocalLength,
          takenAt: exifData?.DateTimeOriginal?.toISOString?.(),
        },
      });
    }

    const outPath = path.join(MANIFEST_DIR, `${albumSlug}.json`);
    await fs.writeFile(outPath, JSON.stringify(entries, null, 2));
    console.log(`  ✓ ${albumSlug}: ${entries.length} photo(s)`);
    albumCount++;
    photoCount += entries.length;
  }

  if (albumCount === 0) {
    console.log("[photo-manifests] no albums with uploaded photos.");
  } else {
    console.log(`[photo-manifests] generated ${albumCount} manifest(s), ${photoCount} photo(s) total.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
