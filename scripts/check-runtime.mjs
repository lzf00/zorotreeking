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
 *   node scripts/check-runtime.mjs --mobile        # 手机视口（390×844）抽查关键模板
 *   node scripts/check-runtime.mjs --viewport=768x1024
 *   node scripts/check-runtime.mjs --vitals         # 顺带量 LCP / CLS / 长任务
 *   node scripts/check-runtime.mjs --vitals --soft-vitals   # 指标超标只警告（CI 用）
 *   node scripts/check-runtime.mjs --vitals --cpu=4         # 降速 4 倍，模拟慢设备
 *   node scripts/check-runtime.mjs --vitals --base=https://www.zorotreeking.online   # 线上实测
 *   node scripts/check-runtime.mjs --dist=dist --wait=2500 --limit=10
 *   node scripts/check-runtime.mjs --vitals --base=https://www.zorotreeking.online --urls=/tmp/urls.txt
 *
 * 判定：pageerror / console error / 同源 4xx-5xx 响应 → 失败（exit 1）。
 *       跨域请求的失败只记录不判失败（第三方统计、字体 CDN 波动不该阻塞发布）。
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isThirdPartyConsoleNoise } from "./lib/console-noise.mjs";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
/**
 * --throttle：用 CDP 模拟移动端弱网（Lighthouse 默认档：下行 1.6 Mbps / 上行 750 kbps /
 * RTT 150 ms），并默认把 CPU 降 4 倍（可用 --cpu= 覆盖）。
 *
 * 为什么需要：不加节流时首屏指标全是「本机局域网速度」，第 73 轮那个
 * 「LCP 被 15KB 字体排队卡到 1.6 s」的问题在无节流本地跑是看不出来的。
 * 线上真实首屏要用这个模式量：`--mobile --throttle`。
 */
const THROTTLE = args.includes("--throttle");
/** --repeat=N：每页测 N 次、取中位数。弱网下 LCP 抖动 100–300 ms，单次跑出来的数字不能当门禁。 */
const REPEAT = Math.max(1, Number(valueOf("repeat", "1")) || 1);
const DIST = path.resolve(valueOf("dist", "dist"));
const WAIT = Number(valueOf("wait", "1500"));
const MOBILE = args.includes("--mobile");
// --vitals：顺带量 LCP / CLS / 长任务。CLS 是硬指标（布局抖动是结构问题，不随机），
// LCP 只做提示——它受机器冷启动与网络影响，硬卡会造成假红。
const VITALS = args.includes("--vitals");
/** 布局稳定性阈值：Core Web Vitals 的 good 线是 0.1 */
const CLS_BUDGET = Number(valueOf("cls", "0.1"));
// LCP 受 CI 机器冷启动影响很大（本机预热后 64–392 ms，共享 runner 可能 1.5 s+），
// 默认阈值故意宽，只拦「明显异常」而不是性能达标线。
const LCP_LIMIT = Number(valueOf("lcp", "6000"));
/**
 * --soft-vitals：LCP/CLS 超标只警告不判失败。
 *
 * 为什么 CI 必须用这个：CI 上是 Playwright 自带的 headless Chromium，本机是系统 Chrome，
 * 两者的布局/时序差异足以让同一个页面在 CI 上多出 0.1 的 CLS（第 67 轮实测，
 * `/invest/etf/` 的错误态折叠）。性能指标用来「发现」，不适合当发布闸门；
 * 真正的闸门是 JS 报错、控制台错误、失败请求——这些不受环境噪声影响。
 * 超标仍会打印 `⚠` 并进入 workflow 的 commit status，看得见但不会挡发布。
 */
const SOFT_VITALS = args.includes("--soft-vitals");
/**
 * --cpu=N：用 CDP 把 CPU 降速 N 倍，模拟中低端手机/CI 的慢机器。
 *
 * 为什么需要：本机（M 系 Mac + 系统 Chrome）测出来全绿的页面，在 CI 的 2 核 runner
 * 上会出现 0.1 的 CLS（第 67/69 轮各一次）。降速能把这个差距在本地复现出来，
 * 例如 `/invest/etf/` 在 4 倍降速下才会暴露 360px 骨架屏塌缩（0.066）。
 */
const CPU_THROTTLE = Number(valueOf("cpu", THROTTLE ? "4" : "1"));
// --mobile 默认用 iPhone 尺寸；显式 --viewport 可覆盖
const VIEWPORT = valueOf("viewport", MOBILE ? "390x844" : "1280x900");
// 默认测本地 dist；传 --base=https://www.zorotreeking.online 就直接测线上（含真实网络）。
const BASE = valueOf("base", "");
const LIMIT = Number(valueOf("limit", "0"));
const ALL_PHOTO = args.includes("--all-photo");
/** --urls=<file>：逐行指定要测的 URL（配合线上全站抽查：`npm run check:runtime -- --vitals --base=… --urls=/tmp/urls.txt`） */
const URLS_FILE = valueOf("urls", "");
/** --explain：位移明细里带上 previousRect → currentRect，定位 CLS 时不用再猜 */
const EXPLAIN = args.includes("--explain");

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
      const contentType = MIME[path.extname(file)] ?? "application/octet-stream";
      // 和 nginx 一样按需 gzip：不压缩的话，138 KB 的首页在 1.6 Mbps 弱网档下要
      // 多传 600 ms，弱网 LCP 会被本地服务器「没有压缩」这件事本身拉高（实测 1228 vs 500 ms）。
      const compressible = /^(text\/|application\/(json|xml|javascript))/.test(contentType) || path.extname(file) === ".svg";
      const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
      if (compressible && acceptsGzip && body.length > 1024) {
        const gz = gzipSync(body);
        res.writeHead(200, { "Content-Type": contentType, "Content-Encoding": "gzip", Vary: "Accept-Encoding" }).end(gz);
        return;
      }
      res.writeHead(200, { "Content-Type": contentType }).end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/** 找 dist 里真实存在的第一个标签页（标签 slug 会随内容变，写死会静默失效） */
async function firstTagPath(lang) {
  const dir = path.join(DIST, lang === "en" ? "en/tag" : "tag");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const slug = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()[0];
  return slug ? (lang === "en" ? `/en/tag/${slug}/` : `/tag/${slug}/`) : null;
}

/**
 * 手机视口只抽查最关键的一批页面（导航折叠、图表网格重排、灯箱全屏都只在窄屏出现），
 * 全量 1186 页两遍太慢；这里的子集覆盖每个模板一次即可。
 */
function mobileTargets(tagZh, tagEn) {
  return [
    "/",
    "/ai/",
    "/ai/digest/",
    "/invest/",
    "/invest/market/",
    "/photo/",
    "/photo/baokemeng/",
    "/hike/",
    tagZh,
    "/en/",
    "/en/photo/baokemeng/",
    tagEn,
  ].filter(Boolean);
}

/** 每个模板挑代表页：岛（island）、图表、灯箱、地图、搜索、错误页都要覆盖到 */
function defaultTargets(tagZh, tagEn) {
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
    tagZh,
    "/about/",
    "/uses/",
    "/en/",
    "/en/ai/",
    "/en/invest/",
    "/en/photo/",
    ...albums.map((slug) => `/en/photo/${slug}/`),
    "/en/hike/",
    tagEn,
  ].filter(Boolean);
}

async function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    console.error(`✗ ${DIST} 里没有 index.html：先 npm run build`);
    process.exit(2);
  }
  const [tagZh, tagEn] = await Promise.all([firstTagPath("zh"), firstTagPath("en")]);
  let pool = MOBILE ? mobileTargets(tagZh, tagEn) : defaultTargets(tagZh, tagEn);
  if (URLS_FILE) {
    const { readFileSync } = await import("node:fs");
    pool = readFileSync(URLS_FILE, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  }
  const wanted = LIMIT ? pool.slice(0, LIMIT) : pool;
  const [vw, vh] = VIEWPORT.split("x").map(Number);
  if (!Number.isFinite(vw) || !Number.isFinite(vh)) {
    console.error(`✗ --viewport 格式应为 宽x高，收到 ${VIEWPORT}`);
    process.exit(2);
  }
  const targets = wanted.filter((url) => existsSync(path.join(DIST, url.replace(/^\//, ""), "index.html")));
  // 静默丢目标最危险：板块改名后这一页就永远不被检查，而报告仍然是「通过」。
  const missing = wanted.filter((url) => !targets.includes(url));
  if (missing.length) {
    console.log(`! 跳过 ${missing.length} 个不存在的目标页（板块改名？清单该更新了）：${missing.join(" ")}`);
  }
  if (targets.length === 0 || missing.length / wanted.length > 0.5) {
    console.error(`✗ ${missing.length}/${wanted.length} 个目标页不存在，清单与站点结构已经对不上`);
    console.error("✗ 目标页面都不存在，dist 可能还没构建完");
    process.exit(2);
  }

  const { chromium } = await import("playwright");
  const server = BASE ? null : await serve(DIST);
  const base = BASE ? BASE.replace(/\/$/, "") : `http://127.0.0.1:${server.address().port}`;
  const executablePath =
    process.env.CHROME_PATH ??
    (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const problems = [];
  const vitalsList = [];
  const softVitals = [];
  let checked = 0;

  try {
    if (VITALS) {
      // 全新 browser 的第一次导航要付冷启动成本（实测 LCP 1.5–1.9 s，第二次起 64–164 ms）。
      // 不预热的话，第一个页面的 LCP 数字毫无参考价值。
      const warmContext = await browser.newContext({ viewport: { width: vw, height: vh } });
      const warmPage = await warmContext.newPage();
      // 预热也要用同样的节流：否则「暖机」和「测量」两个条件不一致，
      // 实测第一页仍会比后面慢 1 s（第 74 轮：冷机身 1572 ms vs 热身后 500 ms）。
      if (CPU_THROTTLE > 1 || THROTTLE) {
        const warmSession = await warmContext.newCDPSession(warmPage);
        if (CPU_THROTTLE > 1) await warmSession.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
        if (THROTTLE) {
          await warmSession.send("Network.enable");
          await warmSession.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 150,
            downloadThroughput: (1.6 * 1024 * 1024) / 8,
            uploadThroughput: (750 * 1024) / 8,
          });
        }
      }
      await warmPage.goto(`${base}/`, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
      await warmPage.waitForTimeout(WAIT);
      await warmContext.close();
    }

    if (REPEAT > 1) console.log(`· 每页测 ${REPEAT} 次取中位数`);
    const plan = [];
    for (let run = 0; run < REPEAT; run += 1) for (const url of targets) plan.push({ url, run });
    for (const { url, run } of plan) {
      const touch = vw < 640;
      const context = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: touch, hasTouch: touch });
      const page = await context.newPage();
      if (CPU_THROTTLE > 1 || THROTTLE) {
        const session = await context.newCDPSession(page);
        if (CPU_THROTTLE > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
        if (THROTTLE) {
          await session.send("Network.enable");
          await session.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 150,
            downloadThroughput: (1.6 * 1024 * 1024) / 8,
            uploadThroughput: (750 * 1024) / 8,
          });
        }
      }
      if (VITALS) {
        await page.addInitScript((explainMode) => {
          window.__vitals = { lcp: 0, cls: 0, long: 0, shifts: [] };
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                window.__vitals.lcp = entry.startTime;
                // 记下 LCP 元素：「LCP 900 ms」本身没有行动价值，知道是 H1 还是 IMG 才能改
                const el = entry.element;
                window.__vitals.lcpEl = el
                  ? `${el.tagName}.${String(el.className ?? "").slice(0, 40)}${el.currentSrc ? ` ${el.currentSrc.split("/").pop()?.slice(0, 40)}` : ""}`
                  : "";
              }
            }).observe({ type: "largest-contentful-paint", buffered: true });
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (entry.hadRecentInput) continue;
                window.__vitals.cls += entry.value;
                if (window.__vitals.shifts.length < 5) {
                  window.__vitals.shifts.push(
                    `${entry.value.toFixed(3)}@${Math.round(entry.startTime)}ms ← ` +
                      (entry.sources || [])
                        .map(
                          (source) =>
                            `${source.node?.tagName ?? "?"}.${String(source.node?.className ?? "").slice(0, explainMode ? 30 : 40)}` +
                            (explainMode
                              ? ` y${Math.round(source.previousRect?.y ?? 0)}→${Math.round(source.currentRect?.y ?? 0)} h${Math.round(source.previousRect?.height ?? 0)}→${Math.round(source.currentRect?.height ?? 0)}`
                              : ""),
                        )
                        .join(" / "),
                  );
                }
              }
            }).observe({ type: "layout-shift", buffered: true });
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) window.__vitals.long += entry.duration;
            }).observe({ type: "longtask", buffered: true });
          } catch {}
        }, EXPLAIN);
      }
      const issues = [];
      page.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 200)}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text().slice(0, 200);
        // 「Failed to load resource」不带 URL，无法判断是不是 /api/*；
        // 失败请求统一由下面的 response 监听器精确判定（能看到状态码 + 路径）。
        if (/Failed to load resource/.test(text)) return;
        // 第三方评论组件（Giscus）在出口受限时会刷自己的报错，与本仓库无关（第 92 轮）
        if (isThirdPartyConsoleNoise(text, m.location()?.url ?? "")) return;
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
      let vitals = null;
      if (VITALS) {
        vitals = await page.evaluate(() => ({
          lcp: Math.round(window.__vitals?.lcp ?? 0),
          lcpEl: window.__vitals?.lcpEl ?? "",
          cls: Number((window.__vitals?.cls ?? 0).toFixed(3)),
          long: Math.round(window.__vitals?.long ?? 0),
          shifts: window.__vitals?.shifts ?? [],
          fcp: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0),
        }));
        vitalsList.push({ url, run, ...vitals });
        // 多轮模式把每轮的数字也打出来：只看中位数看不出「第一轮冷启动」还是「后面真的慢」。
        if (REPEAT > 1) console.log(`        第 ${run + 1}/${REPEAT} 次：LCP ${vitals.lcp} ms · CLS ${vitals.cls}`);
        // 弱网/多轮模式下逐页都打：这时看的是「每页多少 ms」，只打异常页等于没有基线。
        const reportEveryPage = THROTTLE || REPEAT > 1;
        if (run === 0 && (reportEveryPage || vitals.cls > 0 || vitals.lcp > 1500 || vitals.long > 0)) {
          console.log(
            `    ↳ ${url} FCP ${vitals.fcp} ms · LCP ${vitals.lcp} ms · CLS ${vitals.cls} · 长任务 ${vitals.long} ms` +
              `${vitals.lcpEl ? ` · LCP 元素 ${vitals.lcpEl}` : ""}`,
          );
          for (const shift of vitals.shifts) console.log(`        ${shift}`);
        }
      }
      const unique = [...new Set(issues)];
      if (unique.length) {
        if (run === 0) {
          console.log(`✗ ${url}`);
          for (const issue of unique.slice(0, 5)) console.log(`    ${issue}`);
        }
        problems.push(...unique.map((issue) => `${url} → ${issue}`));
      } else if (run === 0) {
        console.log(`✓ ${url}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server?.close();
  }

  // 每页取中位数再判预算：弱网下单次 LCP 会抖 100–300 ms，用单次当门禁会假红。
  const medians = [];
  if (VITALS && vitalsList.length) {
    const byUrl = new Map();
    for (const row of vitalsList) {
      if (!byUrl.has(row.url)) byUrl.set(row.url, []);
      byUrl.get(row.url).push(row);
    }
    const mid = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    for (const [url, rows] of byUrl) {
      medians.push({
        url,
        runs: rows.length,
        fcp: mid(rows.map((row) => row.fcp)),
        lcp: mid(rows.map((row) => row.lcp)),
        cls: mid(rows.map((row) => row.cls)),
        long: mid(rows.map((row) => row.long)),
      });
    }
    for (const row of medians) {
      const clsMessage = `CLS ${row.cls} 超过预算 ${CLS_BUDGET}（布局抖动，实测值不随机）`;
      if (row.cls > CLS_BUDGET) {
        if (SOFT_VITALS) softVitals.push(`${row.url} → ${clsMessage}`);
        else problems.push(`${row.url} → ${clsMessage}`);
      }
      const lcpMessage = `LCP ${row.lcp} ms 超过 ${LCP_LIMIT} ms（先排查字体/大图，用 --explain 看位移）`;
      if (row.lcp > LCP_LIMIT) {
        if (SOFT_VITALS) softVitals.push(`${row.url} → ${lcpMessage}`);
        else problems.push(`${row.url} → ${lcpMessage}`);
      }
    }
  }

  for (const warning of softVitals) console.log(`⚠ ${warning}（--soft-vitals：只提示，不挡发布）`);

  if (VITALS && medians.length) {
    const worstCls = medians.reduce((a, b) => (b.cls > a.cls ? b : a));
    const worstLcp = medians.reduce((a, b) => (b.lcp > a.lcp ? b : a));
    const longestTask = medians.reduce((a, b) => (b.long > a.long ? b : a));
    const worstFcp = medians.reduce((a, b) => (b.fcp > a.fcp ? b : a));
    console.log(
      `\n核心指标：CLS 最差 ${worstCls.cls}（${worstCls.url}）· FCP 最慢 ${worstFcp.fcp} ms（${worstFcp.url}）` +
        ` · LCP 最慢 ${worstLcp.lcp} ms（${worstLcp.url}）· 长任务最多 ${longestTask.long} ms（${longestTask.url}）`,
    );
  }

  if (problems.length) {
    console.error(`\n✗ 运行时自检失败：${checked} 个页面里发现 ${problems.length} 个问题`);
    process.exit(1);
  }
  console.log(`\n✓ 运行时自检通过：${checked} 个页面（${vw}×${vh}），无 JS 报错、无控制台错误、无失败请求`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
