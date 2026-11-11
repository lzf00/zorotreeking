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
  width: number;
  height: number;
  alt: string;
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

    const entries: PhotoEntry[] = [];
    for (const f of files) {
      const inputPath = path.join(albumDir, f);
      const buf = await fs.readFile(inputPath);

      let width = 0;
      let height = 0;
      let webpRelative: string | undefined;
      let ogRelative: string | undefined;
      let thumbRelative: string | undefined;
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
        if (ext.toLowerCase() === ".jpg" || ext.toLowerCase() === ".jpeg" || ext.toLowerCase() === ".png") {
          const webpName = path.basename(f, ext) + ".webp";
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
          webpRelative = photoUrl(albumSlug, webpName);

          // 网格缩略图：相册页一次滚到底要拉全部图，原先用的是全尺寸 webp
          // （1920px、平均 34KB、最大 604KB），一页 1.7MB。三列布局每格
          // 实际显示宽度 ~400px，2x 屏 800px 足够，缩到 720px 基本无感。
          // 原图宽度本来就 ≤720 的不再生成，直接用全尺寸 webp 充当缩略图。
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
                await sharp(buf).rotate().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumbPath);
                console.log(`    + ${thumbName}`);
              } catch (e) {
                console.warn(`    ✗ thumb gen failed ${thumbName}:`, e);
              }
            }
            thumbRelative = photoUrl(albumSlug, thumbName);
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
        width,
        height,
        alt: path.basename(f, path.extname(f)),
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
