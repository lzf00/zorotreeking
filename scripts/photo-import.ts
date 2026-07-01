/**
 * 相册批量导入一站式脚本：
 *   1) 拷贝一个本地目录里的所有图片到 public/photos/uploads/<slug>/
 *   2) 调 build-photo-manifests.ts 生成 manifest（含 EXIF/GPS/尺寸/webp/og.jpg）
 *   3) 自动创建 src/content/photo/<slug>.zh.mdx + <slug>.en.mdx（frontmatter 就绪）
 *   4) 打印下一步 git 命令
 *
 * 用法：
 *   npx tsx scripts/photo-import.ts \
 *     --slug=2026-summer-huangshan \
 *     --title="黄山云海" \
 *     --title-en="Huangshan Sea of Clouds" \
 *     --dir=~/Pictures/huangshan \
 *     --location="安徽 · 黄山" \
 *     --date=2026-06-15 \
 *     --desc="七月的一次徒步"
 *
 * 已存在的 mdx 不覆盖（安全）。如果只想同步一次 manifest，重新跑即可。
 */
import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Args = {
  slug: string;
  title: string;
  titleEn?: string;
  dir: string;
  location?: string;
  date?: string;
  desc?: string;
  descEn?: string;
};

function parseArgs(): Args {
  const map: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z][a-z-]*)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  const missing = ["slug", "title", "dir"].filter((k) => !map[k]);
  if (missing.length) {
    console.error(`缺参数：${missing.join(", ")}`);
    console.error("用法：npx tsx scripts/photo-import.ts --slug=xxx --title=xxx --dir=~/Pics [--title-en=... --location=... --date=YYYY-MM-DD --desc=...]");
    process.exit(1);
  }
  return {
    slug: map.slug!,
    title: map.title!,
    titleEn: map["title-en"],
    dir: map.dir!.replace(/^~/, os.homedir()),
    location: map.location,
    date: map.date,
    desc: map.desc,
    descEn: map["desc-en"],
  };
}

const IMG_RE = /\.(jpe?g|png|webp)$/i;

async function main() {
  const a = parseArgs();
  console.log(`[photo-import] 导入相册: ${a.slug}`);

  // 1) 拷贝
  const srcDir = path.resolve(a.dir);
  const dstDir = path.join(ROOT, "public", "photos", "uploads", a.slug);
  try {
    await fs.access(srcDir);
  } catch {
    console.error(`✗ 源目录不存在: ${srcDir}`);
    process.exit(1);
  }
  await fs.mkdir(dstDir, { recursive: true });
  const files = (await fs.readdir(srcDir)).filter((f) => IMG_RE.test(f));
  if (files.length === 0) {
    console.error(`✗ 源目录里没有图片: ${srcDir}`);
    process.exit(1);
  }
  console.log(`  找到 ${files.length} 张图，拷贝到 ${path.relative(ROOT, dstDir)}/`);
  let copied = 0, skipped = 0;
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dst = path.join(dstDir, f);
    try {
      await fs.access(dst);
      skipped++;
      continue;
    } catch { /* 不存在 → 拷贝 */ }
    await fs.copyFile(src, dst);
    copied++;
  }
  console.log(`  ✓ 拷贝 ${copied} · 跳过（已存在）${skipped}`);

  // 2) 生成 manifest（复用现有脚本）
  console.log("  运行 build-photo-manifests.ts…");
  try {
    execSync(`npx tsx ${path.join(ROOT, "scripts", "build-photo-manifests.ts")}`, {
      stdio: "inherit",
      cwd: ROOT,
    });
  } catch (e) {
    console.warn(`⚠ manifest 生成失败: ${(e as Error).message}`);
  }

  // 3) 生成 mdx（zh + en），已存在不覆盖
  const date = a.date || new Date().toISOString().slice(0, 10);
  const zhContent = renderMdx({
    lang: "zh",
    slug: a.slug,
    title: a.title,
    date,
    location: a.location,
    desc: a.desc,
  });
  const enContent = renderMdx({
    lang: "en",
    slug: a.slug,
    title: a.titleEn || a.title,
    date,
    location: a.location,
    desc: a.descEn || a.desc,
  });

  const zhPath = path.join(ROOT, "src", "content", "photo", `${a.slug}.zh.mdx`);
  const enPath = path.join(ROOT, "src", "content", "photo", `${a.slug}.en.mdx`);
  const writes: string[] = [];
  for (const [p, content] of [[zhPath, zhContent], [enPath, enContent]] as [string, string][]) {
    try {
      await fs.access(p);
      console.log(`  · 已存在跳过: ${path.relative(ROOT, p)}`);
    } catch {
      await fs.writeFile(p, content, "utf-8");
      writes.push(path.relative(ROOT, p));
      console.log(`  + 创建: ${path.relative(ROOT, p)}`);
    }
  }

  // 4) 打印下一步
  console.log("\n✅ 完成。下一步：");
  console.log(`   1. 检查 ${zhPath} 里的 title/description/location`);
  console.log(`   2. git add public/photos/uploads/${a.slug}/ src/data/photo-manifest/${a.slug}.json ${writes.join(" ")}`);
  console.log(`   3. git commit -m "content(photo): ${a.slug}" && git push`);
  console.log(`   4. 3 分钟后可访问 https://www.zorotreeking.online/photo/${a.slug}/`);
}

function renderMdx(opts: {
  lang: "zh" | "en";
  slug: string;
  title: string;
  date: string;
  location?: string;
  desc?: string;
}): string {
  const { lang, slug, title, date, location, desc } = opts;
  const lines: string[] = [];
  lines.push("---");
  lines.push(`lang: ${lang}`);
  lines.push(`translationKey: ${slug}`);
  lines.push(`title: "${title.replace(/"/g, '\\"')}"`);
  if (desc) lines.push(`description: "${desc.replace(/"/g, '\\"')}"`);
  lines.push(`date: ${date}`);
  if (location) lines.push(`location: "${location.replace(/"/g, '\\"')}"`);
  lines.push(`tags: [photo]`);
  lines.push(`draft: false`);
  lines.push("---");
  lines.push("");
  lines.push(lang === "zh"
    ? "<!-- 可以在这里写这次拍摄的手记；也可以留空，相册页会展示图片瀑布流 + 地图。 -->"
    : "<!-- Optional notes about this shoot. Can be left empty — the album page will show a waterfall + map. -->"
  );
  lines.push("");
  return lines.join("\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
