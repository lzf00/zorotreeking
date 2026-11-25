#!/usr/bin/env node
/**
 * `docs/known-debt.md` 里的数字由内容算出来、写回文档（第 201 轮）。
 *
 * 事故：2026-11-24/25，`daily-digest` 连续四次挂在 `Unit and guard tests`，线上两天没更新。
 * 根因不是代码 —— 日报流水线新产出一期"缺摘要"的内容，文档里的「38 期 / 299 条」过期，
 * `tests/known-debt.test.ts` 变红，`npm test` 变红，部署被拦。
 * **一个每天都会变的业务指标，把整站发布卡死了。**
 *
 * 两种修法：
 *   1. 删掉这条断言 —— 文档立刻变成装饰品，欠账数字又开始撒谎；
 *   2. 让数字自己长出来 —— 文档永远是真的，测试只负责验证"算出来的 == 写下来的"。
 * 这里选 2：`npm test` 前的 `pretest` 会先跑本脚本 `--write`，CI 与本地都不会再被它拦。
 *
 * 用法：
 *   node scripts/sync-known-debt.mjs            # 同步（默认写盘）
 *   node scripts/sync-known-debt.mjs --check    # 只检查，过期则退出 1
 *   node scripts/sync-known-debt.mjs --dry-run  # 打印差异但不写
 *   node scripts/sync-known-debt.mjs --root=DIR # 指定仓库根（测试用）
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DOC_PATH = "docs/known-debt.md";

/** 一个 ## 小节（一条新闻/摘要）是不是"没内容"：除标记符号外没有正文行 */
function sectionIsEmpty(section) {
  const lines = section.split("\n").slice(1).map((line) => line.trim());
  return !lines.some((line) => line.length > 0 && !/^[*<>!\-|#(（]/.test(line));
}

/**
 * 纯函数：算出日报"缺摘要"的欠账（期数、条数、其中整期全空/部分缺各多少期）。
 * 统计口径与 `tests/known-debt.test.ts` 一致：只数 `digest-YYYY-MM-DD.zh.mdx`，
 * 正文按 `## ` 切小节，小节里没有正文行就算缺。
 */
export function digestDebtFrom(files) {
  let periods = 0;
  let items = 0;
  let wholeEmpty = 0;
  let partial = 0;
  for (const raw of files) {
    const body = raw.split("---").slice(2).join("---");
    const sections = body.split(/^## /m).slice(1);
    const missing = sections.filter(sectionIsEmpty).length;
    if (missing === 0) continue;
    periods += 1;
    items += missing;
    if (sections.length > 0 && missing === sections.length) wholeEmpty += 1;
    else partial += 1;
  }
  return { periods, items, wholeEmpty, partial };
}

/** 读内容目录，返回所有日报中文正文（供 digestDebtFrom 用） */
export async function readDigestBodies(root) {
  const bodies = [];
  for (const stream of ["ai", "invest"]) {
    const dir = path.join(root, "src", "content", stream);
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!/^digest-\d{4}-\d{2}-\d{2}\.zh\.mdx$/.test(name)) continue;
      bodies.push(await readFile(path.join(dir, name), "utf8"));
    }
  }
  return bodies;
}

/** 英文页中文残留的"文件数 / 处数"（来自 `scripts/i18n-leaks-baseline.json`） */
export function i18nLeakNumbers(baseline) {
  const values = Object.values(baseline ?? {});
  return {
    files: values.length,
    hits: values.reduce((sum, n) => sum + (Number(n) || 0), 0),
  };
}

/**
 * 纯函数：把算出来的数字写进文档文本。
 * 只替换两处被测试盯住的粗体数字，其余文字原样保留（包括括号里的历史说明）。
 * @returns {{ text: string, changes: { label: string, from: string, to: string }[] }}
 */
export function syncDoc(text, { debt, leaks }) {
  const changes = [];
  let out = text;

  const debtPattern = /\*\*\d+ 期 \/ \d+ 条\*\*（\d+ 期整期全空，\d+ 期部分缺）/;
  const debtReplacement = `**${debt.periods} 期 / ${debt.items} 条**（${debt.wholeEmpty} 期整期全空，${debt.partial} 期部分缺）`;
  const debtMatch = out.match(debtPattern);
  if (debtMatch && debtMatch[0] !== debtReplacement) {
    changes.push({ label: "日报缺摘要", from: debtMatch[0], to: debtReplacement });
    out = out.replace(debtPattern, debtReplacement);
  }

  const leakPattern = /\*\*\d+ 个文件 \/ \d+ 处\*\*/;
  const leakReplacement = `**${leaks.files} 个文件 / ${leaks.hits} 处**`;
  const leakMatch = out.match(leakPattern);
  if (leakMatch && leakMatch[0] !== leakReplacement) {
    changes.push({ label: "英文页中文残留", from: leakMatch[0], to: leakReplacement });
    out = out.replace(leakPattern, leakReplacement);
  }

  return { text: out, changes };
}

export async function collectNumbers(root = DEFAULT_ROOT) {
  const debt = digestDebtFrom(await readDigestBodies(root));
  let baseline = {};
  try {
    baseline = JSON.parse(await readFile(path.join(root, "scripts", "i18n-leaks-baseline.json"), "utf8"));
  } catch {
    baseline = {};
  }
  return { debt, leaks: i18nLeakNumbers(baseline) };
}

function parseArgs(argv) {
  const args = { check: false, dryRun: false, root: DEFAULT_ROOT, json: false };
  for (const arg of argv) {
    if (arg === "--check") args.check = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg.startsWith("--root=")) args.root = path.resolve(arg.slice("--root=".length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const docPath = path.join(args.root, DOC_PATH);
  const original = await readFile(docPath, "utf8");
  const numbers = await collectNumbers(args.root);
  const { text, changes } = syncDoc(original, numbers);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ numbers, changes }, null, 2)}\n`);
  }

  if (changes.length === 0) {
    if (!args.json) console.log(`known-debt 数字与内容一致（${numbers.debt.periods} 期 / ${numbers.debt.items} 条；${numbers.leaks.files} 文件 / ${numbers.leaks.hits} 处）`);
    return 0;
  }

  for (const change of changes) {
    console.log(`${args.check || args.dryRun ? "✗" : "✓"} ${change.label}：${change.from} → ${change.to}`);
  }

  if (args.check) {
    console.error("::error title=known-debt 数字过期::先跑 node scripts/sync-known-debt.mjs 再提交");
    return 1;
  }
  if (args.dryRun) return 0;

  await writeFile(docPath, text, "utf8");
  // 写盘时给 CI 一条可见的提示：文档不会撒谎，但这次是自动改的
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=known-debt 自动同步::按内容更新了 ${changes.length} 处数字（文档不该靠人手追内容）`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
