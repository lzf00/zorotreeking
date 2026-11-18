#!/usr/bin/env node
/**
 * 用真实浏览器的 Long Task API 复核「Lighthouse 报的 TBT 到底是不是真的」。
 *
 * 为什么需要：本机 Lighthouse 对部分页面报出 600–1000 ms 的 TBT，但同一份 HTML 在 CDP trace
 * 里根本没有超过 50 ms 的主线程任务——headless 没有 GPU，渐变/合成层多的页面会让软件光栅
 * 时间落到「Unattributable」里，Lighthouse 把它当阻塞时间算进 TBT。结果就是：
 * 看 TBT 决定要不要优化，可能整轮都在改一个不存在的问题。
 *
 * 这个脚本不看 Lighthouse，只问浏览器：加载期间到底有没有长任务、多长、几次。
 * 判定标准是 PerformanceObserver("longtask")——TBT 的定义本来就是「>50ms 的任务超出部分之和」。
 *
 * 用法：
 *   node scripts/tbt-probe.mjs                                  # 默认探 /、/invest/、/invest/digest/
 *   node scripts/tbt-probe.mjs --urls /hike/sample-route/ --runs 3
 *   node scripts/tbt-probe.mjs --no-throttle                    # 不模拟慢网/慢 CPU
 *   node scripts/tbt-probe.mjs --self-test                      # 用一个人造 300ms 阻塞页验证检测器有效
 *
 * 依赖 dist/（先 npm run build）和本机 Chrome（CHROME_PATH 可覆盖）。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const DEFAULT_URLS = ["/", "/invest/", "/invest/digest/"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export function parseArgs(args) {
  const urlsIndex = args.indexOf("--urls");
  const runsIndex = args.indexOf("--runs");
  const urls = urlsIndex >= 0 ? (args[urlsIndex + 1] ?? "").split(",").map((u) => u.trim()).filter(Boolean) : DEFAULT_URLS;
  const runs = runsIndex >= 0 ? Math.max(1, Math.min(10, Number(args[runsIndex + 1]) || 2)) : 2;
  const selfTest = args.includes("--self-test");
  return { urls: selfTest ? ["/__blocking__"] : urls, runs: selfTest ? 1 : runs, throttle: !args.includes("--no-throttle"), selfTest };
}

/**
 * 把一次加载里的 Long Task 归并成 TBT 口径的统计。
 * TBT = Σ(duration − 50ms)，只算超过 50ms 的部分——和 Lighthouse/Web Vitals 定义一致。
 */
export function summarizeLongTasks(entries) {
  const durations = entries.map((entry) => Number(entry.duration) || 0).filter((value) => value > 0);
  const longest = durations.length ? Math.max(...durations) : 0;
  return {
    count: durations.length,
    total: Math.round(durations.reduce((sum, value) => sum + value, 0)),
    tbt: Math.round(durations.reduce((sum, value) => sum + Math.max(0, value - 50), 0)),
    longest: Math.round(longest),
  };
}

/**
 * 判定：实测 TBT 很小但 LH 报得很大 → 模拟噪声。
 * 阈值 150ms 和 perf:local 的「抖动」判据保持一致；实测低于这个数就不值得为它改代码。
 */
export function verdict(measuredTbt) {
  if (measuredTbt >= 300) return "真实阻塞，值得修";
  if (measuredTbt >= 150) return "轻微阻塞，先看是什么";
  return "无实质阻塞（LH 的 TBT 大概率是软件光栅噪声）";
}

/** 自检页：主线程忙等 300ms，探针必须报出 ~300ms，否则说明检测器本身坏了 */
const SELF_TEST_PAGE = `<!doctype html><meta charset="utf-8"><title>tbt-probe self test</title>
<h1>blocking</h1><script>const t = Date.now(); while (Date.now() - t < 300) {}</script>`;

async function serveDist() {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (pathname === "/__blocking__") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(SELF_TEST_PAGE);
      return;
    }
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

// addInitScript 里要跑的观察器（字符串化传进页面，不依赖打包）
const INIT_SCRIPT = () => {
  window.__longTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__longTasks.push({ duration: entry.duration, start: entry.startTime });
  }).observe({ type: "longtask", buffered: true });
};

async function main() {
  const { urls, runs, throttle, selfTest } = parseArgs(process.argv.slice(2));
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("✗ dist/ 里没有 index.html：先 npm run build");
    process.exit(2);
  }
  const { chromium } = await import("playwright");
  const executablePath =
    process.env.CHROME_PATH ??
    (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const { server, port } = await serveDist();
  const base = `http://127.0.0.1:${port}`;
  const rows = [];
  try {
    for (const path of urls) {
      const samples = [];
      for (let index = 0; index < runs; index += 1) {
        process.stderr.write(`…${path} 第 ${index + 1}/${runs} 次\n`);
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        if (throttle) {
          // 和 CI/perf:local 同一档：150ms RTT、~1.6Mbps、4× CPU
          await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 150,
            downloadThroughput: Math.round((1638 * 1024) / 8),
            uploadThroughput: Math.round((750 * 1024) / 8),
          });
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        }
        await page.addInitScript(INIT_SCRIPT);
        await page.goto(base + path, { waitUntil: "load" });
        await page.waitForTimeout(3000);
        const entries = await page.evaluate(() => window.__longTasks ?? []);
        samples.push(summarizeLongTasks(entries));
        await context.close();
      }
      const worst = samples.reduce((acc, sample) => (sample.tbt > acc.tbt ? sample : acc), samples[0]);
      rows.push({ url: path, samples, worst });
    }
  } finally {
    await browser.close();
    server.close();
  }

  const header = ["URL", "实测 TBT", "长任务数", "最长任务", "判定"];
  const table = rows.map((row) => [
    `\`${row.url}\``,
    `${row.worst.tbt} ms`,
    String(row.worst.count),
    `${row.worst.longest} ms`,
    verdict(row.worst.tbt),
  ]);
  const widths = header.map((cell, index) => Math.max(cell.length, ...table.map((row) => row[index].length)));
  const line = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  console.log([line(header), `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`, ...table.map(line)].join("\n"));
  console.log(`\n每页 ${runs} 次取最差的一次（${throttle ? "150ms RTT + 1.6Mbps + 4× CPU" : "不节流"}）。`);
  console.log("实测 TBT 来自 PerformanceObserver('longtask')，和 Web Vitals 的 TBT 定义一致；");
  console.log("如果这里明显小于 Lighthouse 报的数，那个数就是 headless 软件光栅算出来的假阻塞（见 docs/architecture.md）。");

  if (selfTest) {
    // 人造 300ms 阻塞：抓不到就说明观察器/脚本有问题，别拿它当「页面没问题」的证据
    const measured = rows[0]?.worst.tbt ?? 0;
    if (measured < 200) {
      console.error(`✗ 自检失败：人造 300ms 阻塞只测到 ${measured}ms，探针不可信`);
      process.exit(1);
    }
    console.log(`✓ 自检通过：人造 300ms 阻塞测到 ${measured}ms`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
