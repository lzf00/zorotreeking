/**
 * 照片入库脚本：
 *   - 抽 EXIF
 *   - 用 sharp 生成 large（1920px 长边）+ thumb（480px 长边）+ WebP
 *   - 输出文件可选：本地 public/photos/<album>/ 或 R2（环境变量 R2_* 全部就绪时）
 *   - 写 manifest 到 src/data/photo-manifest/<album>.json
 *
 * 用法：
 *   npx tsx scripts/photo-add.ts <album-slug> <photos-dir>
 *
 * 例：
 *   npx tsx scripts/photo-add.ts 2026-spring-shanghai ~/Pictures/2026-05-spring/
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: npx tsx scripts/photo-add.ts <album-slug> <photos-dir>");
  process.exit(1);
}
const [albumSlug, srcDir] = args;

const useR2 =
  process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY && process.env.R2_SECRET_KEY;

const PUBLIC_BASE = useR2
  ? process.env.R2_PUBLIC_URL!.replace(/\/$/, "")
  : "/photos";

type PhotoEntry = {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  exif?: {
    camera?: string;
    lens?: string;
    iso?: number;
    aperture?: number;
    shutter?: string;
    focal?: number;
    takenAt?: string;
    gps?: { lat: number; lng: number };
  };
};

async function main() {
  // 动态导入重型依赖，避免在 Astro 构建时被打包
  const sharpMod = await import("sharp");
  const exifrMod = await import("exifr");
  const sharp = sharpMod.default;
  const exifr = exifrMod.default ?? exifrMod;

  const files = (await fs.readdir(srcDir))
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
  if (files.length === 0) {
    console.error(`No images found in ${srcDir}`);
    process.exit(1);
  }

  const outLocalDir = path.join(PROJECT_ROOT, "public", "photos", albumSlug);
  if (!useR2) {
    await fs.mkdir(outLocalDir, { recursive: true });
  }

  const manifest: PhotoEntry[] = [];

  for (const file of files) {
    const inputPath = path.join(srcDir, file);
    const baseName = path.basename(file, path.extname(file));
    const buf = await fs.readFile(inputPath);

    const meta = await sharp(buf).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;

    const exif = await exifr.parse(buf, {
      pick: ["Make", "Model", "LensModel", "ISO", "FNumber", "ExposureTime", "FocalLength", "DateTimeOriginal", "GPSLatitude", "GPSLongitude"],
    }).catch(() => ({}));

    const largeBuf = await sharp(buf).rotate().resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const thumbBuf = await sharp(buf).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();

    const largeKey = `${albumSlug}/${baseName}.webp`;
    const thumbKey = `${albumSlug}/${baseName}_thumb.webp`;

    if (useR2) {
      await uploadToR2(largeKey, largeBuf, "image/webp");
      await uploadToR2(thumbKey, thumbBuf, "image/webp");
    } else {
      await fs.writeFile(path.join(outLocalDir, `${baseName}.webp`), largeBuf);
      await fs.writeFile(path.join(outLocalDir, `${baseName}_thumb.webp`), thumbBuf);
    }

    manifest.push({
      src: `${PUBLIC_BASE}/${largeKey}`,
      thumb: `${PUBLIC_BASE}/${thumbKey}`,
      width,
      height,
      alt: baseName,
      exif: {
        camera: exif?.Make && exif?.Model ? `${exif.Make} ${exif.Model}`.trim() : exif?.Model,
        lens: exif?.LensModel,
        iso: exif?.ISO,
        aperture: exif?.FNumber,
        shutter: exif?.ExposureTime ? formatShutter(exif.ExposureTime) : undefined,
        focal: exif?.FocalLength,
        takenAt: exif?.DateTimeOriginal?.toISOString?.(),
        gps: exif?.GPSLatitude && exif?.GPSLongitude ? { lat: exif.GPSLatitude, lng: exif.GPSLongitude } : undefined,
      },
    });

    console.log(`  ✓ ${file} (${width}×${height})`);
  }

  const manifestPath = path.join(PROJECT_ROOT, "src", "data", "photo-manifest", `${albumSlug}.json`);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written → ${path.relative(PROJECT_ROOT, manifestPath)}`);
  console.log(`Total ${manifest.length} photo(s).`);
  if (!useR2) {
    console.log(`Local output: public/photos/${albumSlug}/`);
  }
}

function formatShutter(t: number): string {
  if (t >= 1) return `${t}s`;
  return `1/${Math.round(1 / t)}`;
}

async function uploadToR2(key: string, body: Buffer, contentType: string) {
  // 仅在用到 R2 时按需 import，避免 SDK 进入正常依赖
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY!,
      secretAccessKey: process.env.R2_SECRET_KEY!,
    },
  });
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
