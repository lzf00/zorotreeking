#!/usr/bin/env node
/**
 * 全站无障碍抽查：用 axe-core 把 WCAG 2.0/2.1 A+AA 规则跑在构建产物上。
 *
 * 为什么需要它：Lighthouse 只审 15 个 URL（而且只在 CI 里），归档页、标签页、
 * 个股页这些「不在预算里」的页面从来没人看过对比度和可访问名称。
 *
 * 用法：
 *   npm run a11y:audit              # 抽查 24 个页面（按路径等距抽样，结果稳定）
 *   npm run a11y:audit -- --pages 60
 *   npm run a11y:audit -- --all     # 全部页面（约 1190 个），约 12 分钟
 *   npm run a11y:audit -- --json
 *   npm run a11y:audit -- --only /photography/,/en/photography/   # 只查指定页面（排查用）
 *   npm run a11y:audit -- --scheme both                           # 浅色 + 深色各跑一遍
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DIST = resolve(import.meta.dirname, "../dist");
const AXE = resolve(import.meta.dirname, "../node_modules/axe-core/axe.min.js");
/**
 * 后台入口 `/admin/` 是 `public/admin/index.html` 里加载的第三方 CMS（Decap）外壳，
 * 页面主体是它的 JS 渲染出来的，改不了它的无障碍名称；自家写的 `/admin/*` 页面照常审。
 */
export const EXCLUDED = ["/admin/"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

/** dist 里的 index.html → 站点路径（`/about/index.html` → `/about/`） */
export function urlFromIndexFile(relativePath) {
  const withoutIndex = relativePath.replace(/index\.html$/, "").replaceAll("\\", "/");
  return `/${withoutIndex}`;
}

/** 等距抽样：结果稳定，不会每次跑出不同页面 */
export function sampleEvenly(items, count) {
  if (count >= items.length) return [...items];
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

async function listPages(dir = DIST, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "_astro") continue;
      out.push(...(await listPages(join(dir, entry.name), relative)));
    } else if (entry.name === "index.html") {
      out.push(urlFromIndexFile(relative));
    }
  }
  return out;
}

function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let filePath = normalize(join(root, pathname));
      if (!filePath.startsWith(root)) return res.writeHead(403).end();
      const info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) filePath = join(filePath, "index.html");
      else if (!info) filePath = pathname.endsWith("/") ? join(root, pathname, "index.html") : filePath;
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/** 同一条违规在多个页面上重复出现时，只留一份并记下命中页数 */
export function groupViolations(results) {
  const map = new Map();
  for (const { url, violations } of results) {
    for (const violation of violations) {
      const key = `${violation.id}|${violation.nodes[0]?.target?.join(" ") ?? ""}`;
      const known = map.get(key);
      if (known) {
        known.pages += 1;
        if (!known.pages_list.includes(url)) known.pages_list.push(url);
        known.nodes = Math.max(known.nodes, violation.nodes.length);
      } else {
        map.set(key, {
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          helpUrl: violation.helpUrl,
          selector: violation.nodes[0]?.target?.join(" ") ?? "",
          nodes: violation.nodes.length,
          pages: 1,
          pages_list: [url],
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => (a.impact === b.impact ? b.pages - a.pages : a.impact === "serious" ? -1 : 1));
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const all = args.includes("--all");
  const onlyArg = args.indexOf("--only");
  const schemeArg = args.indexOf("--scheme");
  // 站点支持浅色/深色两套 token，axe 只测当前渲染出来的那一套，所以两种都要跑
  const schemeValue = schemeArg >= 0 ? (args[schemeArg + 1] ?? "light") : "light";
  const schemes = schemeValue === "both" ? ["light", "dark"] : [schemeValue === "dark" ? "dark" : "light"];
  const pageArg = args.indexOf("--pages");
  const count = all ? Infinity : pageArg >= 0 ? Number(args[pageArg + 1]) || 24 : 24;

  const allPages = (await listPages()).sort();
  const pages = allPages.filter((url) => !EXCLUDED.includes(url));
  const only =
    onlyArg >= 0
      ? (args[onlyArg + 1] ?? "")
          .split(",")
          .map((url) => url.trim())
          .filter(Boolean)
      : null;
  const targets = only ?? sampleEvenly(pages, Math.min(count, pages.length));

  const { chromium } = await import("playwright");
  const server = await serve(DIST);
  const base = `http://127.0.0.1:${server.address().port}`;
  // Playwright 自带的浏览器没装（CI 上装、本机不装），优先用环境变量/系统 Chrome
  const executablePath =
    process.env.CHROME_PATH ??
    (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const axeSource = await readFile(AXE, "utf8");
  const results = [];
  const skipped = [];

  try {
    const plan = targets.flatMap((url) => schemes.map((scheme) => ({ url, scheme })));
    for (const [index, { url, scheme }] of plan.entries()) {
      if (index % 50 === 0) console.error(`…${index}/${plan.length}`);
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const label = scheme === "dark" ? `${url} [dark]` : url;
      const response = await page.goto(base + url, { waitUntil: "domcontentloaded" });
      // 构建产物里没有这个文件（例如审计跑到一半有人 rebuild）：别把 404 文本当成页面去审
      if (!response || response.status() >= 400) {
        skipped.push({ url: label, reason: `HTTP ${response?.status() ?? "无响应"}` });
        await context.close();
        continue;
      }
      // 个别页面自己会跳转（例如后台入口）：脚本注入时执行上下文已被销毁，跳过而不是整轮失败
      let violations;
      try {
        await page.addScriptTag({ content: axeSource, timeout: 10_000 });
        violations = await page.evaluate(async () => {
        const result = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        });
          return result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            nodes: v.nodes.map((n) => ({ target: n.target })),
          }));
        });
      } catch (error) {
        skipped.push({ url: label, reason: String(error).split("\n")[0].slice(0, 120) });
        await context.close();
        continue;
      }
      results.push({ url: label, violations });
      await context.close();
    }
    // 有些页面是跳转桩（HTML 里只有 meta refresh），注入脚本时执行上下文已被销毁。
    // 关掉 JS 再跑一次：跳转不会发生，桩自身的 title / lang 仍然值得审。
    const retryWithoutJs = skipped.splice(0);
    for (const { url } of retryWithoutJs) {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      try {
        const response = await page.goto(base + url, { waitUntil: "domcontentloaded" });
        if (!response || response.status() >= 400) {
          skipped.push({ url, reason: `HTTP ${response?.status() ?? "无响应"}` });
          continue;
        }
        await page.addScriptTag({ content: axeSource, timeout: 10_000 });
        const violations = await page.evaluate(async () => {
          const result = await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          });
          return result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            nodes: v.nodes.map((n) => ({ target: n.target })),
          }));
        });
        results.push({ url, violations });
      } catch {
        // 跳转桩连无 JS 也注不进脚本：退化成静态检查它自己的 title / lang
        const html = await (await fetch(base + url)).text();
        const violations = [];
        if (!/<html[^>]*\slang=/i.test(html)) {
          violations.push({ id: "html-has-lang", impact: "serious", help: "<html> 缺 lang", helpUrl: "", nodes: [{ target: ["html"] }] });
        }
        if (!/<title>\s*\S/i.test(html)) {
          violations.push({ id: "document-title", impact: "serious", help: "缺 <title>", helpUrl: "", nodes: [{ target: ["html"] }] });
        }
        results.push({ url, violations });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const grouped = groupViolations(results);
  if (json) {
    console.log(JSON.stringify({ pages: results.length, skipped, grouped }, null, 2));
  } else {
    console.log(`抽查 ${results.length} 个页面（共 ${pages.length} 个），WCAG 2.0/2.1 A+AA`);
    if (skipped.length) console.log(`跳过 ${skipped.length} 个（会自行跳转的页面）：${skipped.map((s) => s.url).join(" ")}`);
    if (!grouped.length) {
      console.log("✅ 没有违规");
    } else {
      for (const v of grouped) {
        console.log(`\n[${v.impact}] ${v.id} — ${v.help}`);
        console.log(`  出现于 ${v.pages} 个页面，${v.nodes} 处；例：${v.selector}`);
        console.log(`  例页：${v.pages_list[0]}  ${v.helpUrl}`);
      }
    }
  }
  process.exit(grouped.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
