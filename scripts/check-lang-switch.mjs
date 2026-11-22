#!/usr/bin/env node
/**
 * 语言切换链接自检 —— 第 176 轮。
 *
 * 站里每条内容都有 `translationKey`，中英文页靠它互相指路。切换按钮写错或某个
 * 翻译没做时，用户点一下就掉进 404（第 175 轮之前还是中文 404）。这个检查把
 * **不变式**钉死：
 *
 *   1. 有切换链接 ⇒ 对端页面一定存在（两种语言都查）
 *   2. 有切换链接 ⇒ 对端也有回链（不会单向）
 *   3. 没有切换链接 ⇒ 对端**确实**不存在（不是忘了做切换）
 *
 * 实测（2026-11-23）：591 对中英互链全部对得上；13 个中文页确实是「只有中文」的
 * （`/explore/`、`/now/`、`/invest/etf/`、`/invest/us-market/`、8 个徒步行程表），
 * 所以它们不显示切换按钮是**对的**。
 *
 * 用法：
 *   node scripts/check-lang-switch.mjs
 *   node scripts/check-lang-switch.mjs --verbose
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "..", "dist");
const VERBOSE = process.argv.includes("--verbose");

/** 跳转桩（`/photography/` → `/photo/`）不是内容页，不参与 */
const isRedirectStub = (html) => /<title>Redirecting to /.test(html);

function pageExists(href) {
  const clean = href.split("#")[0].split("?")[0];
  const abs = path.join(DIST, clean);
  return existsSync(path.join(abs, "index.html")) || existsSync(abs);
}

/** 中文路径 ↔ 英文路径 */
const counterpartOf = (href) =>
  href === "/" ? "/en/" : href.startsWith("/en/") ? href.slice(3) : `/en${href}`;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".html") ? [full] : [];
  });

const pageHref = (file) => {
  const rel = path.relative(DIST, file).replaceAll(path.sep, "/");
  return rel === "index.html" ? "/" : `/${rel.replace(/index\.html$/, "")}`;
};

const problems = [];
const pages = new Map(); // href -> { lang, switchHref }
for (const file of walk(DIST)) {
  const href = pageHref(file);
  if (href === "/404.html" || href === "/404/") continue;
  const html = readFileSync(file, "utf8");
  if (isRedirectStub(html)) continue;
  const lang = /<html[^>]+lang="([^"]+)"/.exec(html)?.[1] ?? "";
  const isEn = href === "/en/" || href.startsWith("/en/");
  // `/en/**` 必须是 `<html lang="en">`，其余是 `zh-CN`：语言属性写错，读屏器会读错音
  const expectedLang = isEn ? "en" : "zh-CN";
  if (lang !== expectedLang) {
    problems.push(`${href} 的 <html lang> 是 "${lang}"，应为 "${expectedLang}"`);
  }
  // 切换按钮：英文页上是「中文」，中文页上是「English」
  const label = isEn ? "中文" : "English";
  const switchHref = new RegExp(`<a[^>]+href="([^"]+)"[^>]*>${label}</a>`).exec(html)?.[1] ?? null;
  pages.set(href, { lang, isEn, switchHref });
}

let pairs = 0;
let intentionalNoSwitch = 0;

for (const [href, page] of pages) {
  if (page.switchHref) {
    if (!pageExists(page.switchHref)) {
      problems.push(`${href} 的切换链接指向不存在的页面：${page.switchHref}`);
      continue;
    }
    const other = pages.get(page.switchHref);
    if (!other) {
      problems.push(`${href} 的切换目标 ${page.switchHref} 不在页面清单里`);
      continue;
    }
    if (!other.switchHref) {
      problems.push(`${href} → ${page.switchHref} 是单向的（对端没有回链）`);
      continue;
    }
    if (other.switchHref !== href) {
      problems.push(`${href} → ${page.switchHref}，但对端指回 ${other.switchHref}`);
      continue;
    }
    pairs++;
    if (VERBOSE) console.log(`✓ ${href} ↔ ${page.switchHref}`);
  } else {
    const counterpart = counterpartOf(href);
    if (pages.has(counterpart)) {
      problems.push(`${href} 没有切换链接，但对端 ${counterpart} 存在（漏了切换）`);
    } else {
      intentionalNoSwitch++;
    }
  }
}

// pairs 是双向计数的，除以 2 才是「对」
console.log(
  `语言切换：${pages.size} 个内容页，${pairs / 2} 对中英互链，` +
    `${intentionalNoSwitch} 个页面确实只有单一语言（不显示切换是正确的）`,
);

if (problems.length) {
  console.error(`::error title=语言切换链接有问题::${problems.length} 处`);
  for (const problem of problems.slice(0, 20)) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("✓ 语言切换自检通过：所有切换链接都指向真实存在且互链的对端");
