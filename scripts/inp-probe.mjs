/**
 * 交互延迟（INP 思路）探针：给「有 React 岛」的页面点几下，量真实交互耗时。
 *
 * 为什么需要它：Lighthouse 只给 TBT（首屏主线程阻塞），站点真正被吐槽的往往是
 * 「点了要等一下才有反应」——相册灯箱、地图拖动、行情切换。这类问题 CI 里没有任何指标。
 *
 * 用 Event Timing API（`PerformanceObserver({type:"event", durationThreshold:16})`）：
 * 浏览器只在交互 ≥16 ms 时才上报 duration，正好是我们要看的那部分。
 * INP 近似取「最慢的那次交互」。
 *
 * 用法：
 *   node scripts/inp-probe.mjs                         # 打生产，默认页面集
 *   node scripts/inp-probe.mjs --base http://127.0.0.1:8912  # 打本地 dist
 *   node scripts/inp-probe.mjs --urls /,/invest/ --mobile
 */
import { chromium } from "playwright";

const DEFAULT_URLS = [
  "/photo/baokemeng/",   // React 相册灯箱
  "/hike/sample-route/", // Leaflet 地图 + recharts 图表
  "/invest/etf/",        // 实时成交额岛
  "/invest/us-market/",  // 最大的一个数据看板岛
  "/guestbook/",         // 表单
];

const parseArgs = (argv) => {
  const args = { base: "https://www.zorotreeking.online", urls: DEFAULT_URLS, mobile: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
    else if (arg === "--urls") args.urls = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--mobile") args.mobile = true;
  }
  return args;
};

/** 把「页面上的可点元素」点一遍，返回每次点击后的交互耗时 */
async function clickThrough(page, mobile) {
  const results = [];

  // 0) 全站都有的两种交互：切主题（整页重绘）和搜索弹窗（要加载 pagefind 索引）。
  //    它们出现在每一页，真实使用频率远高于页面里的具体按钮，所以先测。
  for (const [selector, action] of [
    ["#theme-toggle", "切换主题"],
    ["#open-search", "打开搜索"],
  ]) {
    const trigger = page.locator(selector).first();
    if (await trigger.count()) {
      await trigger.click({ timeout: 3000 }).catch(() => {});
      results.push({ action, ms: await drainEvents(page) });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    }
  }

  // 1) 移动端/桌面端都可能有的菜单按钮
  const toggles = await page.locator('button[aria-label*="菜单"], button[aria-expanded]').all();
  for (const toggle of toggles.slice(0, 1)) {
    await toggle.click({ timeout: 3000 }).catch(() => {});
    results.push({ action: "打开菜单", ms: await drainEvents(page) });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }

  // 2) 相册灯箱
  const galleryImage = page.locator("[data-lightbox], .gallery img, #gallery-\\* img, main img").first();
  if (await galleryImage.count()) {
    await galleryImage.click({ timeout: 3000 }).catch(() => {});
    results.push({ action: "点开图片", ms: await drainEvents(page) });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }

  // 3) 地图：拖一下 / 点一下
  const map = page.locator(".leaflet-container").first();
  if (await map.count()) {
    const box = await map.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
      results.push({ action: "拖动地图", ms: await drainEvents(page) });
    }
  }

  // 4) 第一组筛选按钮（行情页的板块/日期切换）
  const buttons = await page.locator("main button").all();
  for (const button of buttons.slice(0, 2)) {
    const label = (await button.getAttribute("aria-label").catch(() => null))
      || (await button.textContent().catch(() => ""))?.trim().slice(0, 12)
      || "无标签";
    await button.click({ timeout: 3000 }).catch(() => {});
    results.push({ action: `点按钮「${label}」`, ms: await drainEvents(page) });
    await page.waitForTimeout(120);
  }

  if (mobile) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    results.push({ action: "滚动半屏", ms: await drainEvents(page) });
  }

  return results;
}

/** 取本轮累积的 event-timing 条目并清空 */
async function drainEvents(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
    const entries = window.__inpBuffer.splice(0, window.__inpBuffer.length);
    const durations = entries.map((e) => Math.round(e.duration)).filter((d) => Number.isFinite(d));
    return durations.length ? Math.max(...durations) : 0;
  });
}

async function probe({ base, urls, mobile }) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
  });
  const page = await context.newPage();
  // 每页都要重新注册（导航会清掉），所以用 addInitScript
  await page.addInitScript(() => {
    window.__inpBuffer = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__inpBuffer.push(entry);
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  });

  const report = [];
  for (const path of urls) {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err).slice(0, 80)));
    const response = await page.goto(base + path, { waitUntil: "load", timeout: 45000 }).catch(() => null);
    const status = response?.status() ?? 0;
    if (status !== 200) {
      // 404 页面上也有搜索框之类的可点元素，照着点会「测出一个很快的数字」——
      // 第 45 轮就因为把一个不存在的 /chinese-market/ 当成了满分页。
      report.push({ path, interactions: [], errors, status });
      continue;
    }
    await page.waitForTimeout(1200);
    const interactions = await clickThrough(page, mobile);
    report.push({ path, interactions, errors, status });
  }
  await browser.close();
  return report;
}

const summarize = (report) => {
  const rows = [];
  for (const page of report) {
    const worst = page.interactions.reduce((acc, cur) => (cur.ms > (acc?.ms ?? -1) ? cur : acc), null);
    rows.push({
      path: page.path,
      status: page.status ?? 200,
      worstMs: worst?.ms ?? 0,
      worstAction: worst?.action ?? "—",
      detail: page.interactions.map((i) => `${i.action}:${i.ms}ms`).join(" · ") || "无可点元素",
      errors: page.errors.length,
    });
  }
  return rows;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const report = await probe(args);
  const rows = summarize(report);
  console.log(`\n交互延迟探针 · ${args.mobile ? "手机 390×844" : "桌面 1280×900"} · ${args.base}\n`);
  for (const row of rows) {
    if (row.status !== 200) {
      console.log(`⏭️  ${row.path.padEnd(24)} HTTP ${row.status} —— 跳过（不存在或不可访问，别拿它当「很快」）`);
      continue;
    }
    const verdict = row.worstMs <= 200 ? "✅" : row.worstMs <= 500 ? "⚠️" : "❌";
    console.log(`${verdict} ${row.path.padEnd(24)} 最慢 ${String(row.worstMs).padStart(4)} ms  (${row.worstAction})`);
    console.log(`     ${row.detail}`);
    if (row.errors) console.log(`     页面 JS 错误 ${row.errors} 条`);
  }
  const measured = rows.filter((r) => r.status === 200);
  const skipped = rows.length - measured.length;
  const bad = measured.filter((r) => r.worstMs > 200);
  if (skipped) console.log(`\n${skipped} 个页面因 HTTP 状态非 200 被跳过（不计入结论）`);
  console.log(bad.length ? `${bad.length} 个页面交互超过 200 ms 目标线` : "全部可测页面交互 ≤200 ms");
};

if (import.meta.url === `file://${process.argv[1]}`) await main();

export { parseArgs, summarize };
