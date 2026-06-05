/**
 * 一次性：删历史 ai digest-*.mdx 顶部那条 "由 cron 每日 08:00..." blockquote。
 * invest digest 的免责声明保留（合规需要）。
 *
 * 用法：
 *   npx tsx scripts/transform-strip-ai-blockquote.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");

async function main() {
  const dir = path.join(PROJECT_ROOT, "src", "content", "ai");
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith("digest-") && f.endsWith(".mdx"));
  // 匹配：> 由 cron 每日 08:00 北京自动从 ...（可能跨语言变体）。后跟一行空
  const re = /^> 由 cron 每日 08:00[^\n]*\n\n?/m;
  let touched = 0;
  for (const f of files) {
    const full = path.join(dir, f);
    const raw = await fs.readFile(full, "utf-8");
    if (!re.test(raw)) continue;
    const out = raw.replace(re, "");
    touched++;
    console.log(`  ${f}: 删 blockquote`);
    if (!DRY) await fs.writeFile(full, out, "utf-8");
  }
  console.log(`\n[strip-ai-blockquote] ${DRY ? "DRY" : ""} ${touched} 个文件处理`);
}
main().catch((e) => { console.error(e); process.exit(1); });
