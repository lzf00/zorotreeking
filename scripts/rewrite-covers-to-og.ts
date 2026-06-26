/**
 * 一次性脚本：把所有 digest frontmatter 的 cover 字段重写到 og 专用尺寸。
 *
 * 背景：build-photo-manifests 新增了 .og.jpg（1200×630, ~80KB）生成。
 * 之前 backfill 写入的 cover 是 .jpeg 原图（3-4 MB）或 .webp。
 * 改成 .og.jpg 让 OG 分享加载更快、社交平台兼容性更好。
 *
 * 用法：npx tsx scripts/rewrite-covers-to-og.ts
 *
 * 安全性：
 *   - 只改 cover 字段，frontmatter / body 其它内容不动
 *   - .og.jpg 文件不存在的话跳过该篇（不破坏现有 cover）
 *   - 已是 .og.jpg 的跳过
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");

async function main() {
  let touched = 0;
  let skipped = 0;
  let missingOg = 0;
  for (const kind of ["ai", "invest"] as const) {
    const dir = path.join(ROOT, "src", "content", kind);
    let files: string[];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.startsWith("digest-") || !f.endsWith(".zh.mdx")) continue;
      const p = path.join(dir, f);
      const text = await fs.readFile(p, "utf-8");
      const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!m) continue;
      const [, fm, body] = m;
      const coverMatch = fm.match(/^cover:\s*"?([^"\n]+)"?\s*$/m);
      if (!coverMatch) continue;
      const oldCover = coverMatch[1].trim().replace(/^"|"$/g, "");
      if (oldCover.endsWith(".og.jpg")) { skipped++; continue; }

      // 推导对应的 og 路径
      const base = oldCover.replace(/\.(jpe?g|webp|png)$/i, "");
      const ogPath = `${base}.og.jpg`;
      const ogFsPath = path.join(PUB, ogPath.replace(/^\//, ""));
      try {
        await fs.access(ogFsPath);
      } catch {
        missingOg++;
        continue;
      }

      const newFm = fm.replace(/^cover:\s*"?[^"\n]+"?\s*$/m, `cover: "${ogPath}"`);
      const out = `---\n${newFm}\n---\n${body}`;
      await fs.writeFile(p, out, "utf-8");
      touched++;
    }
  }
  console.log(`[rewrite] touched=${touched} skipped(already og)=${skipped} missingOg=${missingOg}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
