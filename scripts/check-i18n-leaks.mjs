#!/usr/bin/env node
/**
 * 英文内容里的中文残留（第 121 轮）。
 *
 * 起因：`/en/invest/market-recap-2026-11-13/` 正文里有整段中文引用（翻译链路只翻了标题和表格）。
 * 页面现在会自己声明"这是机翻，下面引用保留原文"，但**欠账不能无限增长** ——
 * 所以这个脚本把当前欠账写进 baseline，之后**新增**的中文残留会让它失败。
 *
 * 用法：
 *   node scripts/check-i18n-leaks.mjs                  # 对比 baseline（门禁/巡检用）
 *   node scripts/check-i18n-leaks.mjs --update-baseline # 接受当前状态（只在清理后手动跑）
 *   node scripts/check-i18n-leaks.mjs --list            # 只盘点，不判定
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "src", "content");
const BASELINE = path.join(ROOT, "scripts", "i18n-leaks-baseline.json");

const CJK = /[\u4e00-\u9fff]/g;

/** 一行里汉字数 ≥ minChars 才算"读者看得见的中文"。 */
export function leaksInBody(body, { minChars = 15 } = {}) {
  let prose = 0;
  let quotes = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if ((line.match(CJK) ?? []).length < minChars) continue;
    if (line.startsWith("#")) continue; // 原始标题通常保留
    if (line.startsWith(">")) quotes += 1;
    else prose += 1;
  }
  return { prose, quotes, total: prose + quotes };
}

/** 去掉 frontmatter，只留正文。 */
export function bodyOf(raw) {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  return end === -1 ? raw : raw.slice(end + 4);
}

async function scan() {
  const out = {};
  for (const stream of ["ai", "invest"]) {
    let files = [];
    try {
      files = await readdir(path.join(CONTENT, stream));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".en.mdx")) continue;
      const leaks = leaksInBody(bodyOf(await readFile(path.join(CONTENT, stream, file), "utf8")));
      if (leaks.total > 0) out[`${stream}/${file}`] = leaks.total;
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const current = await scan();
  const entries = Object.entries(current).sort(([a], [b]) => a.localeCompare(b));

  if (args.includes("--list")) {
    console.log(`英文内容里仍有中文正文的文件：${entries.length} 个，共 ${entries.reduce((sum, [, n]) => sum + n, 0)} 处`);
    for (const [file, n] of entries) console.log(`  ${n.toString().padStart(3)}  ${file}`);
    return;
  }

  if (args.includes("--update-baseline")) {
    await writeFile(BASELINE, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
    console.log(`已写入 baseline：${entries.length} 个文件`);
    return;
  }

  let baseline = {};
  try {
    baseline = JSON.parse(await readFile(BASELINE, "utf8"));
  } catch {
    console.log("没有 baseline，按空处理（会报所有现存残留）");
  }

  const regressions = [];
  for (const [file, n] of entries) {
    const allowed = baseline[file] ?? 0;
    if (n > allowed) regressions.push({ file, count: n, allowed });
  }
  const fixed = Object.keys(baseline).filter((file) => !(file in current));

  if (regressions.length) {
    console.error("::error title=英文页新增了未翻译的中文::");
    for (const r of regressions) console.error(`  ✗ ${r.file}：${r.count} 处（baseline 允许 ${r.allowed}）`);
    process.exit(1);
  }

  console.log(
    `英文中文残留：${entries.length} 个文件在 baseline 内（共 ${entries.reduce((sum, [, n]) => sum + n, 0)} 处）` +
      (fixed.length ? `；另有 ${fixed.length} 个文件已清理干净` : ""),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
