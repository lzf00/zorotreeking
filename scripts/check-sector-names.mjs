/**
 * 检查「数据源里出现的申万板块名」是否都有英文译文。
 *
 * 为什么单独做成脚本而不是测试：Wind 每天返回的板块会轮换，新板块出现时英文页会
 * 回落成中文（这是设计好的降级），但**没人会注意到**。这里在每次 build 时打一行警告，
 * 让人顺手把新板块补进 `SECTOR_NAMES_EN`，而不是等用户来投诉。
 *
 * 默认只警告、退出码 0（不能让数据轮换阻断发布）；`--strict` 时未覆盖即退出 1。
 *
 * 用法：
 *   node scripts/check-sector-names.mjs            # 警告模式（gate 里用这个）
 *   node scripts/check-sector-names.mjs --strict   # 强制覆盖（人工巡检）
 *   node scripts/check-sector-names.mjs --data /tmp/x.json   # 指定数据文件（自测/预演用）
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const DATA_FILE = "src/data/wind-market-latest.json";
const I18N_FILE = "src/lib/market-i18n.ts";

/** 从 market-i18n.ts 源码里抽出词典的键（避免为了扫描再 import 一个 TS 模块） */
export function dictionaryKeys(source) {
  const start = source.indexOf("const SECTOR_NAMES_EN");
  if (start < 0) return new Set();
  const block = source.slice(start, source.indexOf("};", start));
  const keys = new Set();
  for (const match of block.matchAll(/^\s{2}("([^"]+)"|[^":\s]+):/gm)) {
    keys.add(match[2] ?? match[1]);
  }
  return keys;
}

/** 数据里的板块名 - 词典里已有的 = 需要补译的 */
export function unmappedSectors(names, keys) {
  const seen = new Set();
  const missing = [];
  for (const name of names) {
    const clean = String(name ?? "").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    if (!keys.has(clean)) missing.push(clean);
  }
  return missing;
}

const main = () => {
  const strict = process.argv.includes("--strict");
  const dataArg = process.argv.indexOf("--data");
  const root = path.resolve(import.meta.dirname, "..");
  const dataPath = dataArg > -1 ? path.resolve(process.argv[dataArg + 1]) : path.join(root, DATA_FILE);
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const source = readFileSync(path.join(root, I18N_FILE), "utf-8");
  const keys = dictionaryKeys(source);
  const names = (data.sectors ?? []).map((s) => s.name);
  const missing = unmappedSectors(names, keys);

  if (keys.size === 0) {
    console.error("✗ 没从 market-i18n.ts 里解析到 SECTOR_NAMES_EN，检查脚本匹配规则");
    process.exitCode = 1;
    return;
  }
  if (missing.length === 0) {
    console.log(`✓ 板块英文名覆盖完整：${new Set(names.map((n) => String(n).trim())).size} 个全部有译文（词典 ${keys.size} 条）`);
    return;
  }
  const label = `⚠️  有 ${missing.length} 个板块没有英文译文，英文页会回落中文：${missing.join("、")}`;
  if (strict) {
    console.error(label);
    console.error("   把它们补进 src/lib/market-i18n.ts 的 SECTOR_NAMES_EN 即可");
    process.exitCode = 1;
  } else {
    console.log(label);
    console.log("   （只警告，不阻断发布；补词典见 src/lib/market-i18n.ts）");
  }
};

if (import.meta.url === `file://${process.argv[1]}`) main();
