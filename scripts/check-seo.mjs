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
 *   hreflang       每条 alternate 都指向真实页面，且双向互指（中英对照页配对错
 *                  会让 Google 直接忽略整组标注）
 *   内链           href/src 指向的站内文件真的存在（区分大小写，Linux 上大小写错了就是 404）
 *   sitemap        每条 <loc> 都对应一个真实页面，且与该页 canonical 完全一致
 *                  （尾斜杠不一致会让整份 sitemap 变成 301 中转）
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


/** 提取 meta description。content 里常见英文撇号（China's …），不能用 ['"] 当边界。 */
function extractDescription(html) {
  const tag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  return tag ? (attr(tag[0], "content") ?? "").trim() : "";
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

  const desc = extractDescription(html);
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

/**
 * 站内链接自检：每个 href/src 指向的本地文件都必须真的存在，且大小写完全一致。
 *
 * 线上每周有死链巡查（check-links，打的是真实 URL），但它一周才跑一次、而且要连外网；
 * 2026-11 加这条时恰好验证了 1147 个页面、69703 个站内引用全部可解析、0 个大小写错配。
 * 大小写必须区分：本地 macOS 不区分，生产 Linux 区分，写错只有上线才 404。
 */
async function checkInternalLinks(siteOrigin) {
  const entries = await fs.readdir(DIST, { recursive: true, withFileTypes: true });
  const files = new Set();
  const pageDirs = new Set();
  for (const entry of entries) {
    const rel = path.relative(DIST, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join("/");
    if (entry.isDirectory()) continue;
    files.add(`/${rel}`);
    if (entry.name === "index.html") {
      const dir = path.posix.dirname(rel);
      pageDirs.add(dir === "." ? "/" : `/${dir}/`);
    }
  }

  const unresolved = new Map();
  let refs = 0;
  let caseOnly = 0;
  const lower = new Map();
  for (const file of files) {
    const key = file.toLowerCase();
    if (!lower.has(key)) lower.set(key, file);
  }

  for await (const abs of walk(DIST)) {
    const html = await fs.readFile(abs, "utf-8");
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      let raw = decodeEntities(m[1]);
      if (/^https?:\/\//i.test(raw)) {
        if (!raw.startsWith(`${siteOrigin}/`)) continue;
        raw = raw.slice(siteOrigin.length);
      }
      if (!raw.startsWith("/") || raw.startsWith("//")) continue;
      const clean = decodeURIComponent(raw.split("#")[0].split("?")[0]);
      refs += 1;
      if (files.has(clean)) continue;
      if (pageDirs.has(clean) || pageDirs.has(`${clean}/`)) continue;
      if (pageDirs.has(`${clean}/`)) continue;
      if (lower.has(clean.toLowerCase())) {
        caseOnly += 1;
        continue;
      }
      const from = path.relative(DIST, abs);
      if (!unresolved.has(clean)) unresolved.set(clean, { from, count: 0 });
      unresolved.get(clean).count += 1;
    }
  }
  return { refs, caseOnly, unresolved };
}

/**
 * hreflang 必须「指向真实页面 + 双向互指」。
 *
 * 中英对照页靠 translationKey 配对，配错或漏翻译时 Google 会整组忽略标注，
 * 而且不会报错——只能自己对着检查。首页那种 `zh` 自指 + `en` 指向 /en/ 的写法
 * 最容易在新增语言时写歪。
 */
function checkHreflangs(hreflangs, siteOrigin) {
  const errors = [];
  for (const [url, alts] of hreflangs) {
    const own = url.startsWith(`${siteOrigin}/en/`) ? "en" : "zh";
    const other = own === "en" ? "zh" : "en";
    if (alts[own] && alts[own] !== url) {
      errors.push(`hreflang 自指不是自己：${url} → ${alts[own]}`);
    }
    const target = alts[other];
    if (!target) continue;
    const back = hreflangs.get(target);
    if (!back) {
      errors.push(`hreflang 指向的页面没有对应标注：${url} → ${target}`);
      continue;
    }
    if (back[own] !== url) {
      errors.push(`hreflang 未双向互指：${url} → ${target}，但对面写的是 ${back[own] ?? "（无）"}`);
    }
  }
  return errors;
}

/**
 * sitemap 与 canonical 必须逐字一致。
 *
 * 2026-11 加这条校验时才发现 1138 条 <loc> 全都不带尾斜杠，而页面 canonical 和
 * nginx 都是带斜杠的：整份 sitemap 在 Search Console 里都会被判「网页会重定向」，
 * 爬取预算白烧。这种错两边各自看都没毛病，只有对起来才会暴露。
 */
async function checkSitemap(siteOrigin, indexable) {
  const xmlPath = path.join(DIST, "sitemap.xml");
  let xml;
  try {
    xml = await fs.readFile(xmlPath, "utf-8");
  } catch {
    return { errors: ["dist/sitemap.xml 不存在（先跑 npm run build）"], urls: 0 };
  }

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeEntities(m[1]));
  const errors = [];
  if (locs.length === 0) errors.push("sitemap 里没有任何 <loc>");

  const seen = new Set();
  for (const loc of locs) {
    if (seen.has(loc)) errors.push(`sitemap 有重复 URL：${loc}`);
    seen.add(loc);
    if (!loc.startsWith(`${siteOrigin}/`)) {
      errors.push(`sitemap URL 不是本站绝对地址：${loc}`);
      continue;
    }
    const rel = loc.slice(siteOrigin.length + 1);
    let html;
    try {
      html = await fs.readFile(path.join(DIST, rel, "index.html"), "utf-8");
    } catch {
      errors.push(`sitemap 列出的页面不存在：${loc}`);
      continue;
    }
    const canonical = [...html.matchAll(/<link[^>]+rel=["']canonical["'][^>]*>/gi)]
      .map((m) => attr(m[0], "href"))[0];
    if (canonical && canonical !== loc) {
      errors.push(`sitemap 与 canonical 不一致：${loc} ≠ ${canonical}`);
    }
  }
  // 覆盖率：可索引却没进 sitemap 的页面，搜索引擎只能靠外链自己发现
  const missing = [...indexable].filter((url) => !seen.has(url)).sort();
  for (const url of missing.slice(0, 5)) errors.push(`可索引但不在 sitemap：${url}`);
  if (missing.length > 5) errors.push(`…另有 ${missing.length - 5} 个页面不在 sitemap`);

  return { errors, urls: locs.length, missing: missing.length };
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
  /** 所有「既非 noindex、也不是跳转页」的页面 URL，用来查 sitemap 有没有漏收录 */
  const indexable = new Set();
  /** url → { 语言: 对照地址 }，循环结束后统一校验 hreflang 配对 */
  const hreflangs = new Map();
  /** rel → description，用来查「多个页面共用一句描述」 */
  const descriptions = new Map();
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
    const relDir = path.dirname(path.relative(DIST, abs)).replace(/\\/g, "/");
    const pageUrl = `${siteOrigin}/${relDir === "." ? "" : `${relDir}/`}`;
    indexable.add(pageUrl);
    const alts = {};
    for (const m of html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["'][^>]*>/gi)) {
      const href = attr(m[0], "href");
      if (href) alts[m[1].toLowerCase()] = href;
    }
    if (Object.keys(alts).length) hreflangs.set(pageUrl, alts);
    const desc = extractDescription(html);
    if (desc) descriptions.set(path.relative(DIST, abs), desc);
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

  const hreflangErrors = checkHreflangs(hreflangs, siteOrigin);
  const descGroups = new Map();
  for (const [rel, desc] of descriptions) {
    if (!desc) continue;
    if (!descGroups.has(desc)) descGroups.set(desc, []);
    descGroups.get(desc).push(rel);
  }
  const dupDescriptions = [...descGroups.entries()]
    .filter(([, rels]) => rels.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  const links = await checkInternalLinks(siteOrigin);
  const sitemap = await checkSitemap(siteOrigin, indexable);
  console.log();
  console.log(
    `[sitemap] ${sitemap.urls} 条 URL` +
      (sitemap.errors.length
        ? ` · ${sitemap.errors.length} 条问题`
        : ` · 与 canonical 一致 · 覆盖全部 ${indexable.size} 个可索引页面`),
  );
  for (const e of sitemap.errors.slice(0, 6)) console.log(`    · ${e}`);
  if (sitemap.errors.length > 6) console.log(`    … 还有 ${sitemap.errors.length - 6} 条`);

  if (dupDescriptions.length) {
    const pages = dupDescriptions.reduce((n, [, rels]) => n + rels.length, 0);
    console.log(`[描述去重] ${dupDescriptions.length} 组描述重复（共 ${pages} 页），最多的：`);
    for (const [desc, rels] of dupDescriptions.slice(0, 3)) {
      console.log(`    · ${rels.length}× ${desc.slice(0, 48)}… → ${rels[0]}`);
    }
  } else {
    console.log(`[描述去重] 全部唯一`);
  }

  console.log(
    `[内链] ${links.refs} 个站内引用` +
      (links.unresolved.size || links.caseOnly
        ? ` · ${links.unresolved.size} 个打不开 · ${links.caseOnly} 个大小写错配`
        : " · 全部可解析"),
  );
  for (const [target, info] of [...links.unresolved].slice(0, 6)) {
    console.log(`    · ${target}（${info.count} 处，例如 ${info.from}）`);
  }

  console.log(
    `[hreflang] ${hreflangs.size} 个页面有中英对照标注` +
      (hreflangErrors.length ? ` · ${hreflangErrors.length} 条问题` : " · 双向互指正常"),
  );
  for (const e of hreflangErrors.slice(0, 6)) console.log(`    · ${e}`);

  console.log(`[seo] 检查 ${checked} 个页面（跳过 ${skipped}）`);
  const warningTotal = samples.reduce((n, s) => n + s.warnings.length, 0) + warningPages;
  console.log(`[seo] ${errorPages} 页有错误 / ${warningPages} 页只有告警 → 通过\n`);
  if (errorPages > 0) {
    console.log(`[seo] 有错误的页面示例：`);
    for (const s of samples.slice(0, 10)) {
      console.log(`  ${s.rel}: ${s.errors[0]}`);
    }
  }
  if (errorPages > 0 || sitemap.errors.length > 0 || hreflangErrors.length > 0 || links.unresolved.size > 0 || links.caseOnly > 0) {
    process.exit(1);
  }
  void warningTotal;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
