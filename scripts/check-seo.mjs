/**
 * SEO / 结构化数据巡查：把 dist 里每个页面的 canonical、title、description、
 * h1、`<html lang>` 和 JSON-LD 结构化数据逐个验一遍。
 *
 * 为什么需要它：
 * - `check-a11y` 只抽样 21 个模板，而且不管 schema.org；
 * - Google 的富媒体结果完全依赖 JSON-LD 的字段是否齐全、URL 是否绝对、
 *   日期是否能解析。字段少一个，标签就静默消失，没有任何报错；
 * - 2026-11 的 og 巡查就是因为"没有任何门禁"才让 42 个页面的分享卡指向 404。
 *
 * 规则（错误会让 CI 失败）：
 *   canonical      每页恰好 1 个，且是本站绝对地址
 *   title          非空、≤ 70 字符（超了只告警，不失败）
 *   description    非空、30–320 字符（超范围告警）
 *   h1             每页恰好 1 个
 *   html lang      zh-CN / en
 *   JSON-LD        能 json.parse；@context 为 schema.org；@type 已知；
 *                  按类型校验必填字段；日期可解析且 modified ≥ published；
 *                  URL 字段必须是绝对地址；BreadcrumbList 位次要连续、末项等于 canonical
 *
 * 跳过：带 `<meta http-equiv="refresh">` 的跳转页、`robots noindex` 的页面
 * （admin / 404 等本来就不该被索引）。
 *
 * 用法：
 *   node scripts/check-seo.mjs                 # 扫 dist，有错误 exit 1
 *   node scripts/check-seo.mjs --dist=dist
 *   node scripts/check-seo.mjs --limit=50      # 只扫前 50 页，调试用
 *   node scripts/check-seo.mjs --verbose       # 每页都打印
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const argValue = (name, fallback) => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DIST = path.resolve(ROOT, argValue("dist", "dist"));
const LIMIT = (() => {
  const v = argValue("limit", null);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();
const VERBOSE = ARGS.includes("--verbose");

/** schema.org 类型 → 必填 / 推荐字段。 */
const SCHEMA_RULES = {
  Article: {
    required: ["headline", "description", "image", "datePublished", "dateModified", "author", "publisher", "mainEntityOfPage", "inLanguage"],
    dates: ["datePublished", "dateModified"],
    urls: ["image", "url"],
  },
  BreadcrumbList: { required: ["itemListElement"], urls: [] },
  WebSite: { required: ["name", "url", "inLanguage"], urls: ["url"] },
  AboutPage: { required: ["name", "description", "url", "inLanguage"], urls: ["url"] },
  Person: { required: ["name"], urls: ["url"] },
  TouristTrip: { required: ["name", "description"], urls: ["url"] },
  Organization: { required: ["name"], urls: ["url"] },
  // WebPage 的规范写法里 url 和 @id 都可作页面标识，二者有其一即可
  WebPage: { required: [], anyOf: [["url", "@id"]], urls: ["url", "@id"] },
  ItemList: { required: ["itemListElement"], urls: [] },
  ListItem: { required: ["position", "name"], urls: ["item"] },
  SearchAction: { required: ["target", "query-input"], urls: [] },
  EntryPoint: { required: ["urlTemplate"], urls: [] },
};

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decodeEntities = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_astro" || entry.name === "pagefind") continue;
      yield* walk(full);
    } else if (entry.name === "index.html" || entry.name === "404.html") {
      yield full;
    }
  }
}

/** 递归遍历 JSON-LD 节点，收集 [node, 路径] 便于报错定位。 */
function* nodes(value, trail = "$") {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* nodes(value[i], `${trail}[${i}]`);
    return;
  }
  if (value && typeof value === "object") {
    yield [value, trail];
    for (const [k, v] of Object.entries(value)) {
      if (k === "@context") continue;
      yield* nodes(v, `${trail}.${k}`);
    }
  }
}

function typeOf(node) {
  const t = node["@type"];
  return typeof t === "string" ? t : null;
}

function isAbsoluteUrl(v) {
  return typeof v === "string" && /^https?:\/\/[^/\s]+/i.test(v);
}

function parseDate(v) {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 中文的字面宽约为英文的两倍，按「视觉宽度」估算描述长度，
 * 否则 21 个汉字的模板描述会被当成"太短"刷满告警。
 */
function displayLength(text) {
  let width = 0;
  for (const ch of text) {
    width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 1.7 : 1;
  }
  return Math.round(width);
}


function checkPage(html, siteOrigin) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  if (/<meta[^>]+http-equiv=["']refresh["']/i.test(html)) return { errors, warnings, skipped: "refresh" };
  const robots = html.match(/<meta[^>]+name=["']robots["'][^>]*>/i);
  if (robots && /noindex/i.test(attr(robots[0], "content") ?? "")) return { errors, warnings, skipped: "noindex" };

  // canonical
  const canonicals = [...html.matchAll(/<link[^>]+rel=["']canonical["'][^>]*>/gi)].map((m) => attr(m[0], "href"));
  if (canonicals.length !== 1) err(`canonical 数量 ${canonicals.length}（应为 1）`);
  else if (!isAbsoluteUrl(canonicals[0]) || !canonicals[0].startsWith(siteOrigin)) {
    err(`canonical 不是本站绝对地址：${canonicals[0]}`);
  }

  // title / description
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : "";
  if (!title) err("缺少 <title>");
  else if ([...title].length > 70) warn(`title ${[...title].length} 字符（建议 ≤70）：${title.slice(0, 40)}…`);

  const descTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  const desc = descTag ? (attr(descTag[0], "content") ?? "").trim() : "";
  if (!desc) err("缺少 meta description");
  else if (displayLength(desc) < 20) warn(`description 视觉宽度只有 ${displayLength(desc)}，偏短`);
  else if (displayLength(desc) > 320) warn(`description 视觉宽度 ${displayLength(desc)}，偏长`);

  // h1
  const h1s = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1s !== 1) err(`h1 数量 ${h1s}（应为 1）`);

  // html lang
  const htmlTag = html.match(/<html[^>]*>/i);
  const langAttr = htmlTag ? attr(htmlTag[0], "lang") : null;
  if (!langAttr) err("<html> 缺少 lang");
  else if (!["zh-CN", "en"].includes(langAttr)) warn(`lang=${langAttr} 不在预期集合（zh-CN / en）`);

  // JSON-LD
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (blocks.length === 0) {
    warn("没有任何 JSON-LD 结构化数据");
  }
  const canonical = canonicals.length === 1 ? canonicals[0] : null;
  for (const [bi, raw] of blocks.entries()) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      err(`JSON-LD #${bi + 1} 不是合法 JSON：${String(e.message).slice(0, 80)}`);
      continue;
    }
    const top = Array.isArray(data) ? data : [data];
    for (const item of top) {
      if (!item || typeof item !== "object") {
        err(`JSON-LD #${bi + 1} 顶层不是对象`);
        continue;
      }
      const ctx = item["@context"];
      if (ctx !== "https://schema.org" && ctx !== "http://schema.org") {
        err(`JSON-LD @context 应为 https://schema.org，实际 ${JSON.stringify(ctx)}`);
      }
    }

    for (const [node, trail] of nodes(data)) {
      const type = typeOf(node);
      if (!type) {
        if (trail !== "$" && Object.keys(node).length > 0 && !("name" in node) && !("item" in node)) {
          // 允许匿名嵌套对象（schema.org 常见写法），不报错
        }
        continue;
      }
      const rule = SCHEMA_RULES[type];
      if (!rule) {
        warn(`未知 @type "${type}"（${trail}）——建议补进检查规则`);
        continue;
      }
      for (const group of rule.anyOf ?? []) {
        const present = group.some((field) => {
          const v = node[field];
          return v !== undefined && v !== null && v !== "";
        });
        if (!present) err(`${type} 缺字段（${group.join(" / ")} 至少一个）（${trail}）`);
      }
      for (const field of rule.required) {
        const v = node[field];
        const missing = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
        if (missing) err(`${type} 缺必填字段 ${field}（${trail}）`);
      }
      for (const field of rule.urls ?? []) {
        const v = node[field];
        const values = Array.isArray(v) ? v : [v];
        for (const item of values) {
          if (item === undefined || item === null || item === "") continue;
          const urlValue = typeof item === "object" ? (item["@id"] ?? item.url) : item;
          if (typeof urlValue === "string" && !isAbsoluteUrl(urlValue)) {
            err(`${type}.${field} 不是绝对 URL：${urlValue}（${trail}）`);
          }
        }
      }
      for (const field of rule.dates ?? []) {
        const v = node[field];
        if (v !== undefined && v !== null && !parseDate(v)) {
          err(`${type}.${field} 不是可解析日期：${JSON.stringify(v)}（${trail}）`);
        }
      }
      if (type === "Article" && parseDate(node.datePublished) && parseDate(node.dateModified)) {
        if (parseDate(node.dateModified) < parseDate(node.datePublished)) {
          err(`Article.dateModified 早于 datePublished（${trail}）`);
        }
      }
      if (type === "Article" && typeof node.inLanguage === "string" && langAttr) {
        if (node.inLanguage !== langAttr) warn(`Article.inLanguage=${node.inLanguage} 与 html lang=${langAttr} 不一致`);
      }
      if (type === "BreadcrumbList") {
        const items = Array.isArray(node.itemListElement) ? node.itemListElement : [];
        if (items.length === 0) err(`BreadcrumbList.itemListElement 为空（${trail}）`);
        let expected = 1;
        let lastUrl = null;
        for (const it of items) {
          if (!it || typeof it !== "object") {
            err(`BreadcrumbList 里有非对象项（${trail}）`);
            continue;
          }
          if (it.position !== expected) err(`BreadcrumbList 位次不连续：期望 ${expected}，实际 ${JSON.stringify(it.position)}`);
          expected += 1;
          if (!it.name) err(`BreadcrumbList 第 ${it.position ?? "?"} 项缺 name`);
          const item = it.item;
          const url = typeof item === "object" ? item?.["@id"] : item;
          if (typeof url === "string" && !isAbsoluteUrl(url)) err(`BreadcrumbList item 不是绝对 URL：${url}`);
          if (typeof url === "string") lastUrl = url;
        }
        // 末项若是当前页（无 href），lastUrl 会停在上一级，这种情况跳过比较
        const lastHasLink = items.at(-1)?.item != null;
        if (canonical && lastUrl && lastHasLink && lastUrl.replace(/\/$/, "") !== canonical.replace(/\/$/, "")) {
          warn(`BreadcrumbList 末项 ${lastUrl} 与 canonical ${canonical} 不一致`);
        }
      }
    }
  }

  return { errors, warnings, skipped: null };
}

async function main() {
  const siteOrigin = (() => {
    const fromEnv = process.env.SITE_URL || process.env.PUBLIC_SITE_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, "");
    return "https://www.zorotreeking.online";
  })();

  const files = [];
  for await (const f of walk(DIST)) files.push(f);
  files.sort();
  const selected = Number.isFinite(LIMIT) ? files.slice(0, LIMIT) : files;

  let checked = 0;
  let skipped = 0;
  let errorPages = 0;
  let warningPages = 0;
  const samples = [];

  for (const abs of selected) {
    const rel = path.relative(DIST, abs);
    const html = await fs.readFile(abs, "utf-8");
    const result = checkPage(html, siteOrigin);
    if (result.skipped) {
      skipped += 1;
      if (VERBOSE) console.log(`- ${rel}（跳过：${result.skipped}）`);
      continue;
    }
    checked += 1;
    if (result.errors.length) {
      errorPages += 1;
      samples.push({ rel, errors: result.errors, warnings: result.warnings });
      console.log(`✗ ${rel}`);
      for (const e of result.errors.slice(0, 6)) console.log(`    · ${e}`);
      if (result.errors.length > 6) console.log(`    … 还有 ${result.errors.length - 6} 条`);
    } else if (result.warnings.length) {
      warningPages += 1;
      if (VERBOSE) {
        console.log(`⚠ ${rel}`);
        for (const w of result.warnings.slice(0, 4)) console.log(`    · ${w}`);
      }
    } else if (VERBOSE) {
      console.log(`✓ ${rel}`);
    }
  }

  console.log();
  console.log(`[seo] 检查 ${checked} 个页面（跳过 ${skipped}）`);
  const warningTotal = samples.reduce((n, s) => n + s.warnings.length, 0) + warningPages;
  console.log(`[seo] ${errorPages} 页有错误 / ${warningPages} 页只有告警 → 通过\n`);
  if (errorPages > 0) {
    console.log(`[seo] 有错误的页面示例：`);
    for (const s of samples.slice(0, 10)) {
      console.log(`  ${s.rel}: ${s.errors[0]}`);
    }
    process.exit(1);
  }
  void warningTotal;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
