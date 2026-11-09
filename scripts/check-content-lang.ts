/**
 * 内容语言一致性检查。
 *
 * 背景：Decap 开了 i18n(multiple_files) 之后，「这条内容是中文还是英文」由
 * 文件名后缀（.zh / .en）决定，但 frontmatter 里的 `lang` 字段还得写——Astro
 * 的 schema 和各页面的语言过滤都靠它。
 *
 * 危险点：在英文条目里忘了把 `lang` 改成 en 时，构建不会报错，而是静默多出
 * 一条中文（详情页按文件名生成，所以英文页直接空掉）。这个脚本让这种错误在
 * 构建阶段就失败。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLLECTIONS = ["ai", "invest", "photo", "hike"];
const FILE_RE = /^(.+)\.(zh|en)\.(md|mdx)$/;

async function main() {
  const problems: string[] = [];
  let scanned = 0;

  for (const collection of COLLECTIONS) {
    const dir = path.join(ROOT, "src", "content", collection);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue; // 集合目录不存在就跳过
    }
    for (const name of files.filter((f) => /\.(md|mdx)$/.test(f))) {
      scanned++;
      const rel = `src/content/${collection}/${name}`;
      const match = name.match(FILE_RE);
      if (!match) {
        problems.push(`${rel}: 文件名缺少 .zh / .en 后缀`);
        continue;
      }
      const suffix = match[2];
      const raw = await fs.readFile(path.join(dir, name), "utf-8");
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const lang = frontmatter?.[1].match(/^lang:\s*["']?([A-Za-z_-]+)/m)?.[1];
      if (!lang) problems.push(`${rel}: frontmatter 里没有 lang`);
      else if (lang !== suffix) problems.push(`${rel}: 文件名是 .${suffix}，但 lang: ${lang}`);
    }
  }

  if (problems.length > 0) {
    console.error(`✗ 内容语言不一致 ${problems.length} 处：`);
    for (const p of problems.slice(0, 30)) console.error("  " + p);
    if (problems.length > 30) console.error(`  …还有 ${problems.length - 30} 处`);
    process.exit(1);
  }
  console.log(`✓ 内容语言一致性检查通过（${scanned} 个文件）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
