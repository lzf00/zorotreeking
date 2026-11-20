#!/usr/bin/env node
/**
 * 运行时自检：用真实浏览器打开一批代表页面，抓 JS 报错 / 控制台错误 / 失败请求。
 *
 * 为什么需要它：a11y（axe）只看 DOM 语义、check:seo 只看 HTML 文本，两边都不会发现
 * 「React island 水合时抛错」「图表组件访问了 undefined」「某个懒加载资源 404」。
 * 这些错误在页面上表现为局部空白或交互失灵，静态检查永远看不见（2026-11 审计时
 * 逐个模板手点才发现这类问题只能靠浏览器跑）。
 *
 * 覆盖：每个模板挑 1–2 页（中文 + 英文），共约 20–30 页；默认等 1.5s 让水合完成。
 *
 * 用法：
 *   node scripts/check-runtime.mjs                 # 默认模板清单
 *   node scripts/check-runtime.mjs --all-photo     # 三个相册全跑
 *   node scripts/check-runtime.mjs --dist=dist --wait=2500 --limit=10
 *
 * 判定：pageerror / console error / 同源 4xx-5xx 响应 → 失败（exit 1）。
 *       跨域请求的失败只记录不判失败（第三方统计、字体 CDN 波动不该阻塞发布）。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const DIST = path.resolve(valueOf("dist", "dist"));
const WAIT = Number(valueOf("wait", "1500"));
const LIMIT = Number(valueOf("limit", "0"));
const ALL_PHOTO = args.includes("--all-photo");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".map": "application/json; charset=utf-8",
};

/** 静态服务器：先按原路径找文件，找不到再按目录 index.html（与 nginx 行为一致） */
function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname);
      let file = path.join(root, rel);
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = path.join(file, "index.html");
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) {
        const fallback = path.join(root, "404.html");
        const body = await readFile(fallback).catch(() => null);
        if (body) {
          res.writeHead(404, { "Content-Type": MIME[".html"] }).end(body);
          return;
        }
        res.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/** 每个模板挑代表页：岛（island）、图表、灯箱、地图、搜索、错误页都要覆盖到 */
function defaultTargets() {
  const albums = ALL_PHOTO ? ["baokemeng", "hudieren", "123", "mac1"] : ["baokemeng"];
  return [
    "/",
    "/ai/",
    "/ai/digest/",
    "/invest/",
    "/invest/market/",
    "/invest/etf/",
    "/invest/stock/0700.HK/",
    "/photo/",
    ...albums.map((slug) => `/photo/${slug}/`),
    "/hike/",
    "/hike/travel/ali-grand-loop-2026/",
    "/tag/ai/",
    "/about/",
    "/uses/",
    "/en/",
    "/en/ai/",
    "/en/invest/",
    "/en/photo/",
    ...albums.map((slug) => `/en/photo/${slug}/`),
    "/en/hike/",
  ];
}

async function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    console.error(`✗ ${DIST} 里没有 index.html：先 npm run build`);
    process.exit(2);
  }
  const targets = (LIMIT ? defaultTargets().slice(0, LIMIT) : defaultTargets()).filter((url) =>
    existsSync(path.join(DIST, url.replace(/^\//, ""), "index.html")),
  );
  if (targets.length === 0) {
    console.error("✗ 目标页面都不存在，dist 可能还没构建完");
    process.exit(2);
  }

  const { chromium } = await import("playwright");
  const server = await serve(DIST);
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath =
    process.env.CHROME_PATH ??
    (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const problems = [];
  let checked = 0;

  try {
    for (const url of targets) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const issues = [];
      page.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 200)}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text().slice(0, 200);
        // 「Failed to load resource」不带 URL，无法判断是不是 /api/*；
        // 失败请求统一由下面的 response 监听器精确判定（能看到状态码 + 路径）。
        if (/Failed to load resource/.test(text)) return;
        issues.push(`console: ${text}`);
      });
      page.on("response", (r) => {
        if (r.status() < 400) return;
        const link = r.url();
        if (!link.startsWith(base)) return; // 跨域失败不算本站问题
        const rel = link.slice(base.length);
        if (rel === "/404.html") return;
        // /api/* 是服务器端接口（nginx 反代到 Python），dist 里本来就没有，本地静态服务器必 404。
        // 这些接口的可用性由部署后的 smoke 检查负责，不属于静态产物自检范围。
        if (rel.startsWith("/api/")) return;
        issues.push(`HTTP ${r.status()}: ${rel.slice(0, 120)}`);
      });
      const response = await page.goto(base + url, { waitUntil: "load", timeout: 60_000 });
      if (response && response.status() >= 400) issues.push(`HTTP ${response.status()}: 页面自身`);
      await page.waitForTimeout(WAIT);
      checked += 1;
      const unique = [...new Set(issues)];
      if (unique.length) {
        console.log(`✗ ${url}`);
        for (const issue of unique.slice(0, 5)) console.log(`    ${issue}`);
        problems.push(...unique.map((issue) => `${url} → ${issue}`));
      } else {
        console.log(`✓ ${url}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (problems.length) {
    console.error(`\n✗ 运行时自检失败：${checked} 个页面里发现 ${problems.length} 个问题`);
    process.exit(1);
  }
  console.log(`\n✓ 运行时自检通过：${checked} 个页面，无 JS 报错、无控制台错误、无失败请求`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
