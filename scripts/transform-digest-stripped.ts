/**
 * 一次性脚本：把历史 digest mdx 改成"乔布斯苹果 newsroom 风"——
 *   - 去掉 H1 section 标题里的 emoji（🤗 📱 📈 等）
 *   - 去掉 H2 论文/新闻标题里的编号 "1. " "2. " ...
 *   - 去掉 meta 行的 📄 / 🕐 emoji
 *
 * 用法：
 *   npx tsx scripts/transform-digest-stripped.ts            # 真改文件
 *   npx tsx scripts/transform-digest-stripped.ts --dry-run  # 只打印 diff 不写
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");

function transform(src: string): { out: string; touched: number } {
  let touched = 0;

  // 1) H1 去 emoji + 多余空格。匹配 "# 🤗 Hugging Face..." → "# Hugging Face..."
  //    Unicode emoji 范围：常见两个 surrogate pair / 单字符 emoji + 常用品牌色 emoji
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27FF}\u{1F000}-\u{1F2FF}]️?\s*/gu;
  let out = src.replace(/^(# )([^\n]+)$/gm, (_full, hash, rest) => {
    const cleaned = rest.replace(emojiRe, "").trim();
    if (cleaned !== rest.trim()) touched++;
    return `${hash}${cleaned}`;
  });

  // 2) H2 去前导编号 "1. " / "2. " / "12. "（H2 文本可能在 <a>...</a> 内）
  //    匹配 "## <a ...>N. Title</a>" 或 "## N. Title"
  out = out.replace(/^(## (?:<a[^>]*>)?)(\d+)\.\s+/gm, (_full, prefix) => {
    touched++;
    return prefix;
  });

  // 3) meta 行去 emoji（保持 *...* 斜体语义）
  //    匹配 "*📄 HF ★ ..." 或 "*🕐 时间 ..."
  out = out.replace(/^\*([^*\n]+)\*$/gm, (full, content) => {
    const cleaned = content.replace(emojiRe, "").trim();
    if (cleaned !== content.trim()) touched++;
    return `*${cleaned}*`;
  });

  return { out, touched };
}

async function processDir(subdir: "ai" | "invest") {
  const dir = path.join(PROJECT_ROOT, "src", "content", subdir);
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith("digest-") && f.endsWith(".mdx"));
  for (const f of files.sort()) {
    const full = path.join(dir, f);
    const raw = await fs.readFile(full, "utf-8");
    const { out, touched } = transform(raw);
    if (out !== raw) {
      console.log(`  ${subdir}/${f}: ${touched} 处替换`);
      if (!DRY) await fs.writeFile(full, out, "utf-8");
    }
  }
}

async function main() {
  console.log(`[transform-digest-stripped] ${DRY ? "DRY RUN" : "正式跑"}\n── AI ──`);
  await processDir("ai");
  console.log("── Invest ──");
  await processDir("invest");
  if (DRY) console.log("\n（dry-run；去掉 --dry-run 实际写入）");
}

main().catch((e) => { console.error(e); process.exit(1); });
