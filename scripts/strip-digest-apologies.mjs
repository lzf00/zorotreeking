#!/usr/bin/env node
/**
 * 删掉日报正文里"摘要失败"的道歉句（第 115 轮做中文，第 120 轮补英文）。
 *
 * 这类句子的共同形态是**单独一行的括号说明**：
 *   （LLM 摘要失败，请稍后手动补充）
 *   (LLM summarization failed, please manually add it later)
 * 它们是生成/翻译链路写进正文的失败说明，对读者没有任何用。删掉这一行即可，
 * 条目的标题、来源、原文链接都还在 —— 页面顶部会由 `digest-coverage` 说明"本期没有摘要"。
 *
 * 用法：
 *   node scripts/strip-digest-apologies.mjs --dry-run
 *   node scripts/strip-digest-apologies.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "src", "content");

/** 整行即占位符（允许前后括号、斜体星号、句号）。 */
export const APOLOGY_LINE =
  /^[*_]*\s*[（(]\s*(?:LLM\s*)?(?:摘要|summar)[^）)]{0,80}(?:补充|失败|later|failed)[^）)]*[）)]\s*[*_]*\.?$/i;

/** 从一段文本里删掉道歉行，并收掉多余空行。幂等。 */
export function stripApologies(text) {
  const kept = text.split("\n").filter((line) => !APOLOGY_LINE.test(line.trim()));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  let changed = 0;
  let removed = 0;
  for (const stream of ["ai", "invest"]) {
    const dir = path.join(CONTENT, stream);
    let files = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/^digest-\d{4}-\d{2}-\d{2}\.(zh|en)\.mdx$/.test(file)) continue;
      const full = path.join(dir, file);
      const before = await readFile(full, "utf8");
      const after = stripApologies(before);
      if (after === before) continue;
      removed += before.split("\n").filter((line) => APOLOGY_LINE.test(line.trim())).length;
      changed += 1;
      if (!dryRun) await writeFile(full, after);
      console.log(`${dryRun ? "（演练）" : ""}${path.relative(ROOT, full)}`);
    }
  }
  console.log(`\n${dryRun ? "将清理" : "已清理"} ${changed} 个文件，删除 ${removed} 行道歉句`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
