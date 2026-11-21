#!/usr/bin/env node
/**
 * 日报里不许出现"（LLM 摘要失败，请稍后手动补充）"这类占位符（第 113 轮）。
 *
 * 为什么会漏出来：`digest-fetch.ts` 有 `assertSummaryHealth`，但阈值是**失败超过 30% 才不出稿**。
 * 12 条里挂了 1 条 → 8% < 30% → 照发，读者在正文里看到一句"请稍后手动补充"。
 * 线上实测：40 篇日报带这种占位符（2026-11-10 到 2026-11-21）。
 *
 * 用法：
 *   node scripts/check-digest-placeholders.mjs                 # 只看最近 7 天（会 fail）
 *   node scripts/check-digest-placeholders.mjs --days=3
 *   node scripts/check-digest-placeholders.mjs --all           # 全量盘点，只告警不失败
 *   node scripts/check-digest-placeholders.mjs --json
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "src", "content");

/** 已知的占位符句式（摘要失败/为空时脚本写进去的）。 */
export const PLACEHOLDER_PATTERNS = [
  "LLM 摘要失败",
  "自动摘要失败",
  "摘要为空",
  "请稍后手动补充",
  "请手动补充",
  "请手动改写",
];

/** 命中占位符的文案列表（导出给测试用）。 */
export function placeholdersIn(text) {
  return PLACEHOLDER_PATTERNS.filter((needle) => text.includes(needle));
}

/** 该日期是否落在最近 days 天窗口内（含今天）。days 为 Infinity 表示不限。 */
export function inWindow(date, today, days) {
  if (!Number.isFinite(days)) return true;
  const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const delta = toDay(today) - toDay(date);
  return delta >= 0 && delta <= days;
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const json = args.includes("--json");
  const daysArg = args.find((a) => a.startsWith("--days="));
  const today = new Date().toISOString().slice(0, 10);
  const days = all ? Infinity : daysArg ? Number(daysArg.split("=")[1]) : 7;

  const hits = [];
  for (const stream of ["ai", "invest"]) {
    const dir = path.join(CONTENT, stream);
    let files = [];
    try {
      files = (await readdir(dir)).filter((f) => /^digest-\d{4}-\d{2}-\d{2}\.(zh|en)\.mdx$/.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      const date = /\d{4}-\d{2}-\d{2}/.exec(file)[0];
      if (!inWindow(date, today, days)) continue;
      const text = await readFile(path.join(dir, file), "utf8");
      const found = placeholdersIn(text);
      if (found.length) hits.push({ file: `${stream}/${file}`, date, patterns: found });
    }
  }

  if (json) {
    console.log(JSON.stringify({ today, window: all ? "all" : days, hits }, null, 2));
  } else {
    if (hits.length === 0) {
      console.log(`✓ 最近 ${all ? "全部" : `${days} 天`}的日报没有占位符`);
    } else {
      for (const hit of hits) {
        console.error(`✗ ${hit.file}（${hit.date}）含有：${hit.patterns.join("、")}`);
      }
      console.error(`\n${hits.length} 个文件在正文里给读者留下了"摘要失败"的占位符。`);
      if (!all) console.error(`（历史遗留用 --all 盘点；要重跑加 npx tsx scripts/digest-fetch.ts <stream> --force）`);
    }
  }
  // --all 只是盘点，不当失败
  process.exit(all || hits.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
