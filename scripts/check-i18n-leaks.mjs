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


/**
 * 英文页的 HTML 属性里不许有中文（第 168 轮）。
 *
 * 正文泄漏是一类问题（上面按 baseline 管），**交互控件对读屏器说中文**是另一类：
 * 分享栏的 "分享到 Twitter"、评分星的 "3 星 · 还行"、点赞的 "喜欢" —— 英文读者
 * 用读屏器听到的是中文，而所有既有检查都只看正文。
 *
 * 只扫 `<标签 属性="值">` 里的 aria-label / title / placeholder / alt，
 * 并且先把 `<script>`、`<style>` 剥掉：内联 JS/CSS 里的中文字符串是代码，不是界面。
 */
const ATTR_CJK = /[\u4e00-\u9fff]/;
const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)>/g;
const ATTR = /([a-zA-Z-:]+)="([^"]*)"/g;
export const SCANNED_ATTRS = ["aria-label", "title", "placeholder", "alt"];

export function chineseAttrsIn(html) {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const found = new Map();
  for (const tag of stripped.matchAll(TAG)) {
    for (const attr of (tag[2] ?? "").matchAll(ATTR)) {
      const [name, value] = [attr[1].toLowerCase(), attr[2]];
      if (!SCANNED_ATTRS.includes(name) || !ATTR_CJK.test(value)) continue;
      found.set(`${name}="${value.trim().slice(0, 60)}"`, (found.get(`${name}="${value.trim().slice(0, 60)}"`) ?? 0) + 1);
    }
  }
  return found;
}

async function scanAttrs() {
  const DIST = path.join(ROOT, "dist", "en");
  let pages = [];
  try {
    pages = await readdir(DIST, { recursive: true });
  } catch {
    return null; // 还没 build，交给调用方跳过
  }
  const offenders = [];
  for (const rel of pages) {
    if (!rel.endsWith(".html")) continue;
    const html = await readFile(path.join(DIST, rel), "utf8");
    const found = chineseAttrsIn(html);
    if (found.size) offenders.push({ page: `/en/${rel.replace(/index\.html$/, "").replace(/\\/g, "/")}`, found: [...found.keys()] });
  }
  return offenders;
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

  // 第二类泄漏：界面属性（第 168 轮）
  const attrOffenders = await scanAttrs();
  if (attrOffenders === null) {
    console.log("dist/en 还不存在，跳过界面属性检查（先 npm run build）");
    return;
  }
  if (attrOffenders.length) {
    console.error(`::error title=英文页的界面属性里还有中文::${attrOffenders.length} 个页面`);
    for (const offender of attrOffenders.slice(0, 10)) {
      console.error(`  ✗ ${offender.page}：${offender.found.slice(0, 4).join(" / ")}`);
    }
    process.exit(1);
  }
  console.log("界面属性（aria-label/title/placeholder/alt）：英文页 0 处中文");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
