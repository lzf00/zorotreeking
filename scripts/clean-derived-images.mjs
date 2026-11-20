/**
 * 清掉所有派生图片（缩略图 / hero / og），让 build 重新生成。
 *
 * 什么时候需要：
 *  - 改了 `scripts/build-photo-manifests.ts` 里的质量常量（mtime 守卫不会重生成旧质量的图）；
 *  - 怀疑某张派生图坏了、想强制重来。
 *
 * 只删派生文件，原图（.jpeg/.jpg/.png/.webp 原片）一律不动。
 */
import { execFileSync } from "node:child_process";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

const DERIVED = [
  /\.thumb\d*\.webp$/i,
  /\.hero\.webp$/i,
  /\.mid\.webp$/i,
  /\.og\.jpg$/i,
  /(\.og)?\.w640\.(?:jpg|webp)$/i,
  /(\.og)?\.w960\.(?:jpg|webp)$/i,
  // 派生变体的派生（历史遗留）：.og.w640.webp 之类
  /\.(?:og|thumb|hero)\.w(?:640|960)\.webp$/i,
];
const ROOT = path.resolve(import.meta.dirname, "..", "public", "photos");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (DERIVED.some((re) => re.test(entry.name))) out.push(full);
  }
  return out;
}

/**
 * 有些派生变体是**入库**的（`tests/cover-variants.test.ts` 要求日报封面的 w640/w960 变体在仓库里，
 * 否则构建前的那一步没跑就会缺图）。所以这里必须跳过 git 已跟踪的文件，只清本地产生的垃圾。
 */
function trackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "public/photos"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return new Set(out.split("\0").filter(Boolean).map((p) => path.resolve(import.meta.dirname, "..", p)));
  } catch {
    return new Set();
  }
}

const dryRun = process.argv.includes("--dry-run");
const tracked = trackedFiles();
const all = await walk(ROOT).catch(() => []);
const files = all.filter((f) => !tracked.has(f));
const skipped = all.length - files.length;
let bytes = 0;
for (const file of files) {
  bytes += (await stat(file)).size;
  if (!dryRun) await unlink(file);
}
console.log(
  `${dryRun ? "将删除" : "已删除"} ${files.length} 个派生图片（${(bytes / 1024 / 1024).toFixed(1)} MB）` +
    (dryRun ? "，去掉 --dry-run 再执行一次才会真删" : "，下次 build 会重新生成"),
);
if (skipped) console.log(`跳过 ${skipped} 个 git 已跟踪的衍生件（日报封面变体是入库的）`);
