#!/usr/bin/env node
/**
 * 全站巡检：把 sitemap 里的每一页都真的加载一次，记录失败与首屏指标。
 *
 * 和 check-runtime 的分工：
 *   check-runtime  抽 21 个代表页、每次发布后跑、**硬闸门**（CLS/JS 报错/失败请求都拦发布）
 *   audit-site     全量 1186 页、每周跑一次、**只出报告**（发现「某一类页面集体坏了」）
 *
 * 为什么需要全量：抽样永远覆盖不到长尾。站内有 800+ 相册页、几十条路线页、几百篇日报，
 * 它们的模板各自演化，抽样 21 页时「只有某一种模板坏掉」这类问题会一直藏到用户投诉。
 *
 * 用法：
 *   node scripts/audit-site.mjs                        # 本地 dist，全量，快速模式
 *   node scripts/audit-site.mjs --limit=60 --sample=even
 *   node scripts/audit-site.mjs --base=https://www.zorotreeking.online --vitals
 *   选项：--concurrency=4 --vitals --limit=N --sample=even|random --resume --out=路径
 *
 * 产出 JSONL（每页一行），可以 `--resume` 续跑；结尾打印汇总，有任何硬失败则 exit 1。
 */
import { createWriteStream } from "node:fs";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

/** 简单命令行解析：--k=v / --k v / --flag */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    if (body.includes("=")) {
      const [key, ...rest] = body.split("=");
      args[key] = rest.join("=");
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[body] = next;
      i += 1;
    } else {
      args[body] = "true";
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const number = (value, fallback) => (value === undefined ? fallback : Number(value));

const DIST = path.resolve(args.dist ?? "dist");
const EXTERNAL_BASE = args.base ? args.base.replace(/\/$/, "") : "";
const LIMIT = number(args.limit, 0); // 0 = 全量
const SAMPLE = args.sample ?? "even";
const CONCURRENCY = Math.max(1, number(args.concurrency, 4));
const VITALS = args.vitals === "true";
const RESUME = args.resume === "true";
const TIMEOUT = number(args.timeout, 25_000);
const OUT = path.resolve(args.out ?? "reports/site-audit.jsonl");
const QUIET = args.quiet === "true";

if (!EXTERNAL_BASE && !existsSync(DIST)) {
  console.error(`没有构建产物：${DIST}。先跑 npm run build，或用 --base=<线上地址>。`);
  process.exit(2);
}

/** sitemap 里的 URL → 站内路径（`https://a/x/` → `/x/`）；拿不到就退回目录扫描 */
async function collectUrls() {
  const sitemapPath = args.sitemap ? path.resolve(args.sitemap) : path.join(DIST, "sitemap.xml");
  if (existsSync(sitemapPath)) {
    const xml = await readFile(sitemapPath, "utf8");
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
      try {
        return new URL(m[1].trim()).pathname;
      } catch {
        return null;
      }
    });
    const unique = [...new Set(urls.filter(Boolean))];
    if (unique.length) return unique;
  }
  console.error(`⚠ 读不到 sitemap（${sitemapPath}），退回目录扫描——可能漏掉非 index.html 的路由。`);
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir, prefix = "") => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("_")) continue; // /_astro 是资源目录
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), `${rel}/`)));
      else if (entry.name === "index.html") out.push(`/${rel}`);
    }
    return out;
  };
  return walk(DIST);
}

/** 抽样：even 按固定步长均匀撒（能覆盖到各个 section），random 真随机 */
function sampleUrls(urls) {
  if (!LIMIT || LIMIT >= urls.length) return urls;
  if (SAMPLE === "random") {
    const copy = [...urls];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, LIMIT).sort();
  }
  const step = urls.length / LIMIT;
  return Array.from({ length: LIMIT }, (_, i) => urls[Math.floor(i * step)]);
}

async function main() {
  const all = await collectUrls();
  const targets = sampleUrls(all);
  if (!QUIET) {
    console.log(
      `全站巡检：${targets.length}/${all.length} 页 · 并发 ${CONCURRENCY} · ${VITALS ? "带首屏指标" : "只查失败"} · ` +
        `${EXTERNAL_BASE || "本地 dist"}`,
    );
    if (VITALS && CONCURRENCY > 2) {
      // CLS 是结构性的，压并发不影响；LCP 会被 CPU 抢占与冷启动推高（实测同一页 112 与 860 ms）。
      // 想要能横向比较的 LCP，就把并发压到 1–2，或者直接看 check:runtime 的弱网中位。
      console.log(`⚠ 并发 ${CONCURRENCY} > 2：LCP 会被 CPU 抢占推高，只看趋势与离群页，别当绝对值；CLS 不受影响。`);
    }
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  const seen = new Set();
  if (RESUME && existsSync(OUT)) {
    const lines = (await readFile(OUT, "utf8")).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row?.url) seen.add(row.url);
      } catch {}
    }
    if (!QUIET) console.log(`续跑：跳过已完成 ${seen.size} 页`);
  } else {
    await appendFile(OUT, "");
  }
  const pending = targets.filter((url) => !seen.has(url));

  // serveDist 返回 Promise<server>（内部等 listen 完成），这里要 await
  const server = EXTERNAL_BASE ? null : await serveDist(DIST);
  const base = EXTERNAL_BASE || `http://127.0.0.1:${server.address().port}`;

  const executablePath = chromePath();
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });
  const out = createWriteStream(OUT, { flags: "a" });
  const write = (row) => out.write(`${JSON.stringify(row)}\n`);

  const failures = [];
  const results = [];
  let done = 0;
  const startedAt = Date.now();

  const worker = async (queue) => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      // 真实下载量：用 CDP 的 encodedDataLength 累加。
      // 不能从 dist 里「引用了哪些文件」去算——`<picture>` 的 `<img src>` 兜底图、
      // 灯箱的原始大图都会出现在 HTML 里，但现代浏览器根本不会下载（实测 /photo/hudieren/
      // 静态引用 5.6 MB，真实下载 ~200 KB）。只有浏览器自己报的传输量才是真的。
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      let bytes = 0;
      let requests = 0;
      cdp.on("Network.loadingFinished", ({ encodedDataLength }) => {
        bytes += encodedDataLength ?? 0;
      });
      cdp.on("Network.requestWillBeSent", () => {
        requests += 1;
      });
      const issues = [];
      page.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text().slice(0, 160);
        if (/Failed to load resource/.test(text)) return; // 失败请求由 response 精确记录
        issues.push(`console: ${text}`);
      });
      page.on("response", (r) => {
        if (r.status() < 400) return;
        const link = r.url();
        if (!link.startsWith(base)) return;
        const rel = link.slice(base.length);
        if (rel === "/404.html" || rel.startsWith("/api/")) return;
        issues.push(`HTTP ${r.status()}: ${rel.slice(0, 100)}`);
      });

      if (VITALS) {
        await page.addInitScript(() => {
          window.__v = { lcp: 0, cls: 0, lcpEl: "" };
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                window.__v.lcp = entry.startTime;
                const el = entry.element;
                if (el) window.__v.lcpEl = `${el.tagName}.${String(el.className ?? "").slice(0, 30)}`;
              }
            }).observe({ type: "largest-contentful-paint", buffered: true });
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__v.cls += entry.value;
              }
            }).observe({ type: "layout-shift", buffered: true });
          } catch {}
        });
      }

      let status = 0;
      try {
        const response = await page.goto(base + url, { waitUntil: "load", timeout: TIMEOUT });
        status = response?.status() ?? 0;
        if (status >= 400) issues.push(`HTTP ${status}: 页面自身`);
        // 等首屏稳定：LCP 可能被图片/字体推动，1.2s 足够覆盖本地 dist 与线上常态
        await page.waitForTimeout(VITALS ? 1200 : 250);
      } catch (error) {
        issues.push(`导航失败: ${String(error.message ?? error).slice(0, 160)}`);
      }

      let vitals;
      if (VITALS && status > 0 && status < 400) {
        vitals = await page
          .evaluate(() => ({
            lcp: Math.round(window.__v?.lcp ?? 0),
            cls: Number((window.__v?.cls ?? 0).toFixed(3)),
            lcpEl: window.__v?.lcpEl ?? "",
          }))
          .catch(() => undefined);
      }

      await context.close();
      const row = {
        url,
        status,
        bytes: Math.round(bytes / 1024), // KB，方便人看
        requests,
        ...(vitals ?? {}),
        ...(issues.length ? { issues: [...new Set(issues)] } : {}),
      };
      write(row);
      results.push(row);
      if (issues.length) failures.push(row);
      done += 1;
      if (!QUIET) {
        const pct = Math.round((done / pending.length) * 100);
        const flag = issues.length ? "✗" : "·";
        const extra = vitals ? ` LCP ${vitals.lcp} CLS ${vitals.cls}` : "";
        if (issues.length || done % 50 === 0 || done === pending.length) {
          console.log(`${flag} [${String(done).padStart(4)}/${pending.length} ${String(pct).padStart(3)}%] ${url}${extra}`);
          for (const issue of row.issues ?? []) console.log(`      ${issue}`);
        }
      }
    }
  };

  // 预热：同一个浏览器第一次导航要付进程/字体/光栅化的初始化成本，实测首页会被量成
  // 2000+ ms（中位却是 112 ms）。预热一次再开始，报告里就不会出现「首页最慢」这种假信号。
  if (pending.length) {
    const warmContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const warmPage = await warmContext.newPage();
    await warmPage.goto(base + pending[0], { waitUntil: "load", timeout: TIMEOUT }).catch(() => {});
    await warmPage.waitForTimeout(300);
    await warmContext.close();
  }

  const queue = [...pending];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, () => worker(queue)));
  await new Promise((resolve) => out.end(resolve));
  await browser.close();
  server?.close();

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const byStatus = new Map();
  for (const row of results) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  console.log(`\n巡检完成：${results.length} 页 / ${seconds}s · 失败 ${failures.length} 页`);
  console.log(`状态码分布：${[...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || "无响应"}×${v}`).join(" · ")}`);
  if (VITALS && results.length) {
    const lcp = results.filter((row) => row.lcp > 0).map((row) => row.lcp).sort((a, b) => a - b);
    const cls = results.filter((row) => typeof row.cls === "number").map((row) => row.cls).sort((a, b) => b - a);
    const p = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    console.log(
      `首屏：LCP 中位 ${p(lcp, 0.5)} ms / p95 ${p(lcp, 0.95)} ms / 最慢 ${lcp[lcp.length - 1]} ms · ` +
        `CLS 最差 ${cls[0]} / p95 ${p(cls, 0.05)}`,
    );
    const worstLcp = [...results].filter((row) => row.lcp > 0).sort((a, b) => b.lcp - a.lcp).slice(0, 8);
    for (const row of worstLcp) console.log(`  LCP ${String(row.lcp).padStart(5)} ms  ${row.url}  ${row.lcpEl ?? ""}`);
    const worstCls = [...results].filter((row) => row.cls > 0.01).sort((a, b) => b.cls - a.cls).slice(0, 8);
    for (const row of worstCls) console.log(`  CLS ${row.cls.toFixed(3)}  ${row.url}`);
  }
  const withBytes = results.filter((row) => row.bytes > 0);
  if (withBytes.length) {
    const sorted = [...withBytes].sort((a, b) => b.bytes - a.bytes);
    const kb = sorted.map((row) => row.bytes).sort((a, b) => a - b);
    const mid = kb[Math.floor((kb.length - 1) / 2)];
    console.log(`下载量：中位 ${mid} KB / p95 ${kb[Math.floor(kb.length * 0.95)]} KB / 最重 ${sorted[0].bytes} KB`);
    for (const row of sorted.slice(0, 8)) console.log(`  ${String(row.bytes).padStart(6)} KB (${row.requests} 请求)  ${row.url}`);
  }
  if (failures.length) {
    console.log(`\n失败页（前 20）：`);
    for (const row of failures.slice(0, 20)) console.log(`  ${row.url}\n    ${row.issues.join("\n    ")}`);
  }
  console.log(`\n明细：${path.relative(process.cwd(), OUT)}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
