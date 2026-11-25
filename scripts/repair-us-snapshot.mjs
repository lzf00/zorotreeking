#!/usr/bin/env node
/**
 * 把仓库里那份「不可发布」的美股快照恢复成最近一份能发布的版本 —— 第 186 轮。
 *
 * 事故：`refresh-us-macro.yml` 的两个抓取步骤都是 `continue-on-error`，抓了一半
 * （`stale: true`）照样提交。这份文件一进仓库，`tests/market-snapshot-verify.test.ts`
 * 立刻红（"仓库里的快照本身就过不了闸门"）→ `npm test` 红 → **整个部署链停摆**。
 * 2026-11-25 停摆了 41 小时（生产一直停在 11-24 03:05 的构建）。
 *
 * 这一轮改了两处：源头上让刷新工作流先校验再提交；接收端在部署跑测试前把坏快照
 * 换成历史里最近一份合格的（`git show <sha>:src/data/us-market-latest.json`），
 * 这样部署不会被数据问题卡死 —— 旧但完整的数据比"新但一半"强，也比"整站停更"强。
 *
 * 用法：
 *   node scripts/repair-us-snapshot.mjs            # 就地修复（CI/本地都可用）
 *   node scripts/repair-us-snapshot.mjs --dry-run  # 只报告，不写文件
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { verifySnapshot } from "./verify-us-market-snapshot.mjs";

const FILE = "src/data/us-market-latest.json";
const dryRun = process.argv.includes("--dry-run");

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

function check(raw) {
  try {
    return verifySnapshot(JSON.parse(raw));
  } catch (error) {
    return { ok: false, problems: [`不是合法 JSON：${error instanceof Error ? error.message : String(error)}`] };
  }
}

const current = readFileSync(FILE, "utf8");
const currentCheck = check(current);
if (currentCheck.ok) {
  console.log(`✓ ${FILE} 可发布（无需修复）`);
  process.exit(0);
}
console.log(`✗ ${FILE} 不可发布：${currentCheck.problems.join("；")}`);

/** 往前找最近一份合格的版本。20 个提交足够——快照每天最多一次，坏数据不会连续 20 天。 */
const history = git("log", "--format=%H", "-20", "--", FILE).split("\n").filter(Boolean);
for (const sha of history) {
  let raw;
  try {
    raw = git("show", `${sha}:${FILE}`);
  } catch {
    continue;
  }
  const result = check(raw);
  if (!result.ok) continue;
  const short = sha.slice(0, 8);
  if (!dryRun) writeFileSync(FILE, raw);
  console.log(`${dryRun ? "可恢复" : "已恢复"}到 ${short}（${git("log", "-1", "--format=%ad %s", "--date=short", sha)}）`);
  console.log(`::warning::仓库里的美股快照不可发布（${currentCheck.problems[0]}），已在部署前恢复为 ${short} 那份。刷新工作流应当先过 verify-us-market-snapshot 再提交。`);
  process.exit(0);
}

// 一份都找不到：说明是系统性问题（接口长期或字段变了），此时不该静默——报错让人来看。
console.log(`::error::历史里 20 个版本没有一份通过校验，${FILE} 无法自动修复`);
process.exit(1);
