#!/usr/bin/env node
/**
 * 内容日期卫生检查：`updated` 字段是否跟得上真实编辑。
 *
 * sitemap 的 `lastmod` 取 frontmatter 的 `updated ?? date`（第 58 轮审计确认）。
 * 这个值只会在作者手工改字段时更新，容易忘。忘了的后果：内容改过但 sitemap 说没变，
 * 搜索引擎按旧时间调度重抓，新内容迟迟不进索引；反过来乱填会让 lastmod 不可信。
 *
 * 判定（保守，只报「看起来真的忘了改」的）：
 *   · 文件最后一次提交日期 比 `updated ?? date` 晚 14 天以上
 *   · **且** 那次提交只动了 ≤ 5 个内容文件（批量重构/全站改字段会一次动上百个文件，
 *     这类提交大多不改变正文，不该算作「内容更新」）
 *   · **且** 那次提交的正文指纹变了（只改外链、修 JSX 语法这类机械修复不算内容更新，
 *     硬把 `updated` 改成今天等于对搜索引擎说谎，见 scripts/lib/prose-fingerprint.mjs）
 *
 * 用法：
 *   node scripts/check-content-dates.mjs                 # 只报告，退出码 0
 *   node scripts/check-content-dates.mjs --strict        # 有疑似就退出码 1
 *   node scripts/check-content-dates.mjs --days=30       # 放宽阈值
 *   node scripts/check-content-dates.mjs --json          # 机器可读
 *
 * 接在 `npm run gate` 里（仅报告）：慢慢补，不要为了绿灯乱填 `updated`。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { sameProse } from "./lib/prose-fingerprint.mjs";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const JSON_OUT = args.includes("--json");
const days = Number((args.find((a) => a.startsWith("--days=")) ?? "--days=14").split("=")[1]);
const ROOT = process.cwd();
const CONTENT_DIR = "src/content";

/** 一次 git 调用拿全量历史：log 是新→旧，所以每个文件第一次出现就是最后一次提交 */
function loadHistory() {
  const out = execFileSync(
    "git",
    ["log", "--name-only", "--format=COMMIT\t%H\t%cs", "--", CONTENT_DIR],
    { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  const files = new Map(); // path → { date, fileCount }
  let current = null;
  let touched = 0;
  const flush = () => {
    if (!current) return;
    for (const file of current.list) {
      if (!files.has(file)) files.set(file, { sha: current.sha, date: current.date, fileCount: touched });
    }
  };
  for (const line of out.split("\n")) {
    if (line.startsWith("COMMIT\t")) {
      flush();
      const [, sha, date] = line.split("\t");
      current = { sha, date };
      touched = 0;
    } else if (line.trim()) {
      current.list ??= [];
      current.list.push(line.trim());
      if (/\.(md|mdx)$/.test(line)) touched += 1;
    }
  }
  flush();
  return files;
}

/** 从 frontmatter 里取 date / updated（兼容带引号与纯 ISO） */
function readDates(text) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const pick = (key) => {
    const hit = frontmatter.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
    if (!hit) return null;
    const value = hit[1].trim();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
  };
  return { date: pick("date"), updated: pick("updated") };
}

/** 读这个文件在指定提交之前的版本，和当前版本比正文指纹 */
function isMechanicalEdit(sha, file, currentText) {
  // 这类内部错误必须炸出来：2026-11-20 的一次迭代里 history 忘了存 sha，
  // 结果 `git show undefined~1:file` 失败被 catch 吞掉，全部文件都被当成"正文变了"，
  // 工具看起来在正常工作，其实判定逻辑整段失效。
  if (!sha) throw new Error(`内部错误：history 条目缺 sha（${file}）`);
  let previous;
  try {
    previous = execFileSync("git", ["show", `${sha}~1:${file}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return false; // 上一版不存在（新增文件）→ 一定是内容变化
  }
  return sameProse(previous, currentText);
}

const history = loadHistory();
const flagged = [];
let checked = 0;

for (const [file, commit] of history) {
  const abs = path.join(ROOT, file);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue; // 历史里存在但已被删除/改名的文件
  }
  const { date, updated } = readDates(text);
  const declared = updated ?? date;
  if (!declared) continue;
  checked += 1;
  const lagDays = Math.round((Date.parse(commit.date) - Date.parse(declared)) / 86_400_000);
  if (lagDays <= days || commit.fileCount > 5) continue;
  // 机械修复（去外链、补 JSX 斜杠）不改正文，不该要求更新日期
  if (isMechanicalEdit(commit.sha, file, text)) continue;
  flagged.push({ file: file.replace(`${CONTENT_DIR}/`, ""), declared, gitDate: commit.date, lagDays, fileCount: commit.fileCount });
}

flagged.sort((a, b) => b.lagDays - a.lagDays);

if (JSON_OUT) {
  console.log(JSON.stringify({ checked, threshold: days, flagged }, null, 2));
} else if (flagged.length === 0) {
  console.log(`✓ 内容日期一致：${checked} 篇都在 ${days} 天内跟上了最后一次正文提交`);
} else {
  console.log(`! ${checked} 篇里有 ${flagged.length} 篇疑似忘了更新 \`updated\`（提交比字段晚 >${days} 天，且不是批量重构）：`);
  for (const entry of flagged.slice(0, 20)) {
    console.log(`  ${entry.file}: 字段 ${entry.declared} / 提交 ${entry.gitDate}（晚 ${entry.lagDays} 天，该提交动了 ${entry.fileCount} 个文件）`);
  }
  if (flagged.length > 20) console.log(`  …另有 ${flagged.length - 20} 篇`);
  console.log("  处理方式：确认正文确实改过再补 `updated:`，不要为了消警告乱填。");
}

process.exit(STRICT && flagged.length ? 1 : 0);
