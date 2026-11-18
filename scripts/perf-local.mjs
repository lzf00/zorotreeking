#!/usr/bin/env node
/**
 * 在本机对 dist/ 跑 Lighthouse，拿一个「不受 runner 网络抖动影响」的基线。
 *
 * 为什么需要它：CI 上的分数是「美国 runner + devtools 限速」，同一份 HTML 两轮能差 9–20 分
 * （见 docs/architecture.md 的噪声记录）。想判断「这次改的是真的慢了，还是 runner 抽风」，
 * 就得有一个本机可复现的参照点：CPU 固定 4× 节流、网络走 localhost，分数是稳定的。
 *
 * lighthouse 没有进 devDependencies（装一次几十 MB，CI 每个 job 都要 npm ci）。
 * 用之前先全局装一份：
 *   npm i -g lighthouse
 * 或者用临时的：
 *   HOME=/tmp/lhh npm i --prefix /tmp/lh lighthouse
 *   LIGHTHOUSE_BIN=/tmp/lh/node_modules/.bin/lighthouse node scripts/perf-local.mjs
 *
 * 用法：
 *   npm run perf:local                          # 默认 /、/invest/、/explore/、/photo/ 各 2 次
 *   npm run perf:local -- --urls /invest/,/ai/ --runs 3
 *   npm run perf:local -- --json
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const DIST = new URL("../dist/", import.meta.url).pathname;
const DEFAULT_URLS = ["/", "/invest/", "/explore/", "/photo/"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".json": "application/json",
};

export function parseArgs(args) {
  const urlsArg = args.indexOf("--urls");
  const runsArg = args.indexOf("--runs");
  const noWarmup = args.includes("--no-warmup");
  const urls = urlsArg >= 0 ? (args[urlsArg + 1] ?? "").split(",").map((u) => u.trim()).filter(Boolean) : DEFAULT_URLS;
  const runs = runsArg >= 0 ? Math.max(1, Math.min(10, Number(args[runsArg + 1]) || 2)) : 2;
  return { urls, runs, json: args.includes("--json"), warmup: !noWarmup };
}

/** 每次运行的分数取中位数——单次要吗抽到好签、要吗抽到坏签 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function lighthouseBin() {
  if (process.env.LIGHTHOUSE_BIN) return process.env.LIGHTHOUSE_BIN;
  for (const candidate of ["/tmp/lh/node_modules/.bin/lighthouse"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "lighthouse";
}

async function serveDist() {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(DIST, pathname));
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      if (!res.headersSent) res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

/**
 * 先把 HTML 和它引用的静态资源读一遍，让操作系统的文件缓存热起来。
 * 不预热的话「第一个被测页面」会明显偏慢（实测同一台机器、同样 4× CPU：
 * 先测 /invest/ 是 FCP 1184ms，先测 /explore/ 时它自己 1160ms、/invest/ 只要 292ms）——
 * 慢的不是页面，是冷缓存。Lighthouse 每次都会开新的 Chrome 实例，但 OS 层缓存是共享的。
 */
async function warmFileCache(base, urls) {
  for (const path of urls) {
    let html = "";
    try {
      html = await (await fetch(base + path)).text();
    } catch {
      continue;
    }
    const assets = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map((match) => match[1]);
    await Promise.all(
      [...new Set(assets)].slice(0, 40).map((asset) => fetch(base + asset).then((response) => response.arrayBuffer()).catch(() => {})),
    );
  }
}

async function runOnce(url, outPath) {
  await execFileAsync(
    lighthouseBin(),
    [
      url,
      "--preset=desktop",
      "--quiet",
      "--chrome-flags=--headless=new --no-sandbox",
      // 固定 CPU 节流：去掉「这次刚好在跑别的」带来的抖动
      "--throttling-method=simulate",
      "--throttling.cpuSlowdownMultiplier=4",
      "--only-categories=performance",
      "--output=json",
      `--output-path=${outPath}`,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  ).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error("没找到 lighthouse。先 `npm i -g lighthouse`，或用 LIGHTHOUSE_BIN 指向可执行文件。");
    }
    throw error;
  });
  const report = JSON.parse(await readFile(outPath, "utf8"));
  const audits = report.audits;
  return {
    perf: Math.round((report.categories.performance?.score ?? 0) * 100),
    fcp: Math.round(audits["first-contentful-paint"]?.numericValue ?? 0),
    lcp: Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0),
    tbt: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
    cls: Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { urls, runs, json, warmup } = parseArgs(process.argv.slice(2));
  const { server, port } = await serveDist();
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  try {
    if (warmup) {
      process.stderr.write("预热文件缓存…\n");
      await warmFileCache(base, urls);
    }
    for (const path of urls) {
      const samples = [];
      for (let index = 0; index < runs; index += 1) {
        process.stderr.write(`…${path} 第 ${index + 1}/${runs} 次\n`);
        samples.push(await runOnce(base + path, join(tmpdir(), `lh-local-${process.pid}.json`)));
      }
      const summary = {
        url: path,
        samples,
        perf: median(samples.map((sample) => sample.perf)),
        fcp: median(samples.map((sample) => sample.fcp)),
        lcp: median(samples.map((sample) => sample.lcp)),
        tbt: median(samples.map((sample) => sample.tbt)),
      };
      results.push(summary);
    }
  } finally {
    server.close();
  }
  if (json) {
    console.log(JSON.stringify({ runs, results }, null, 2));
  } else {
    const header = ["URL", "性能", "FCP", "LCP", "TBT"];
    const rows = results.map((result) => [`\`${result.url}\``, String(result.perf), `${result.fcp} ms`, `${result.lcp} ms`, `${result.tbt} ms`]);
    const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
    const line = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
    console.log([line(header), `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`, ...rows.map(line)].join("\n"));
    console.log(`\n本地基线（desktop preset + 4× CPU 节流，${runs} 次取中位数）。CI 上的分数会低一些且抖动更大，只适合和这个基线做相对比较。`);
    console.log("注意：headless Chrome 没有 GPU，渐变/合成层多的页面会把软件光栅算进主线程，TBT 会虚高（首页实测 964–1054ms，但真实 trace 里没有任何 >2ms 的主线程任务）。TBT 只看趋势，别当回归判据。");
  }
}
