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
 *   node scripts/inp-probe.mjs --fail-on-404            # 月度清单用：有 404 直接退出 1
 */
import { chromium } from "playwright";
import { aggregateRounds, worstOf } from "./lib/inp-aggregate.mjs";

const DEFAULT_URLS = [
  "/photo/baokemeng/",   // React 相册灯箱
  "/hike/sample-route/", // Leaflet 地图 + recharts 图表
  "/invest/etf/",        // 实时成交额岛
  "/invest/us-market/",  // 最大的一个数据看板岛
  "/guestbook/",         // 表单
];

const parseArgs = (argv) => {
  const args = {
    base: "https://www.zorotreeking.online",
    urls: DEFAULT_URLS,
    mobile: false,
    failOn404: false,
    repeat: 3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
    else if (arg === "--urls") args.urls = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--mobile") args.mobile = true;
    else if (arg === "--fail-on-404") args.failOn404 = true;
    else if (arg === "--repeat") args.repeat = Math.max(1, Number(argv[++i]) || 1);
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
      await settle(page);
      await trigger.click({ timeout: 3000 }).catch(() => {});
      results.push({ action, ms: await drainEvents(page) });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    }
  }

  // 1) 移动端/桌面端都可能有的菜单按钮
  const toggles = await page.locator('button[aria-label*="菜单"], button[aria-expanded]').all();
  for (const toggle of toggles.slice(0, 1)) {
    await settle(page);
    await toggle.click({ timeout: 3000 }).catch(() => {});
    results.push({ action: "打开菜单", ms: await drainEvents(page) });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }

  // 2) 相册灯箱
  // 第 127 轮修正：原来这里选的是 `…, main img`，相册页第一个匹配到的是**首图 hero**（不在 <a> 里），
  // 点它根本不会开灯箱 —— 于是「点开图片 792 ms」量的是一个不可点图片的绘制，纯噪声。
  // 只点真正的灯箱链接（PhotoSwipe 的 <a data-pswp-width>），并确认灯箱真的开了。
  const galleryLink = page.locator("a[data-pswp-width], [data-lightbox], .gallery a").first();
  if (await galleryLink.count()) {
    await settle(page);
    await galleryLink.click({ timeout: 5000 }).catch(() => {});
    // PhotoSwipe 的核心包是动态 import 的，点完不会立刻有 DOM —— 要等它挂上再判定，
    // 否则「没打开」是假阴性（我第一版就踩了：判定太早，误以为灯箱坏了）。
    const opened = await page
      .waitForSelector(".pswp", { state: "attached", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (opened) {
      results.push({ action: "点开灯箱", ms: await drainEvents(page) });
    } else {
      results.push({ action: "点开灯箱（没打开，跳过）", ms: 0, skipped: true });
    }
    await page.keyboard.press("Escape").catch(() => {});
    // 灯箱关掉要等 DOM 撤干净，否则下一轮点的是"被浮层挡住"的链接
    await page.waitForSelector(".pswp", { state: "detached", timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(150);
  }

  // 3) 地图：拖一下 / 点一下
  // 第 126 轮起地图默认是静态 SVG 预览（点「加载交互地图」才水合 Leaflet，为了 LCP），
  // 所以这里要先点一下预览上的按钮，否则探针会永远看不到 .leaflet-container。
  const mapButton = page.getByRole("button", { name: /加载交互地图/ }).first();
  if (await mapButton.count()) {
    await mapButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector(".leaflet-container", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
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
    await settle(page);
    const label = (await button.getAttribute("aria-label").catch(() => null))
      || (await button.textContent().catch(() => ""))?.trim().slice(0, 12)
      || "无标签";
    await button.click({ timeout: 3000 }).catch(() => {});
    results.push({ action: `点按钮「${label}」`, ms: await drainEvents(page) });
    await page.waitForTimeout(120);
  }

  if (mobile) {
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    results.push({ action: "滚动半屏", ms: await drainEvents(page) });
  }

  return results;
}

/**
 * 只保留**用户真的做了动作**的事件类型（第 128 轮）。
 *
 * 原来取窗口内所有 event-timing 条目的最大值，于是灯箱打开时浏览器补发的
 * `pointerout` / `pointerleave`（页面内容变了，指针被"赶走"）也被算进去 ——
 * 实测 720 ms 的最慢项就是这两个，而用户那一下 click 只有 184 ms。
 * INP 规范统计的同样只是交互类事件，不是所有事件。
 */
const INTERACTION_EVENTS = new Set(["pointerdown", "pointerup", "click", "keydown", "keyup", "touchstart", "touchend"]);

/**
 * 这个页面的"空转帧间隔"（第 129 轮）。
 *
 * 为什么需要：本地 headless + 2x DPR 跑相册页（48 张大图）时实测帧间隔 ~150 ms，
 * 也就是**环境下限**——任何交互的 Event Timing duration 都不可能低于这个数。
 * 之前把 576 ms 直接判成「用户点开灯箱要等半秒」，其实是把机器慢算到了页面上。
 * 现在每页先量 10 帧中位数，判定时扣掉超出 16 ms 的部分，并把两个数都打出来。
 */
async function baselineFrameMs(page) {
  const intervals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        let n = 0;
        const tick = () => {
          const now = performance.now();
          out.push(now - last);
          last = now;
          n += 1;
          if (n < 10) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  const sorted = intervals.slice(1).sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
}

/**
 * 测一次动作之前，先把页面"静下来"（第 129 轮）。
 *
 * 之前每一步之间只 `waitForTimeout(150)`，上一步的关闭动画（搜索弹窗淡出、抽屉收起）
 * 还没跑完，下一次点击的"下一帧"就被这段动画顶住：桌面端点「喜欢」因此报出 352 ms，
 * 而连点三次实测是 48 / 16 / 88 ms —— 差的全是残留动画的账。
 * 现在：等 260 ms + 连续两帧 + 清空缓冲，确保带内只有这一次动作。
 */
async function settle(page) {
  await page.waitForTimeout(260);
  await page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
  );
  await page.evaluate(() => {
    window.__inpBuffer.length = 0;
  });
}

/** 取本轮累积的 event-timing 条目并清空 */
async function drainEvents(page) {
  return page.evaluate(async (names) => {
    await new Promise((resolve) => setTimeout(resolve, 260));
    const allowed = new Set(names);
    const entries = window.__inpBuffer.splice(0, window.__inpBuffer.length);
    const durations = entries
      .filter((e) => allowed.has(e.name))
      .map((e) => Math.round(e.duration))
      .filter((d) => Number.isFinite(d));
    return durations.length ? Math.max(...durations) : 0;
  }, [...INTERACTION_EVENTS]);
}

async function probe({ base, urls, mobile, repeat = 1 }) {
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
    const frameMs = await baselineFrameMs(page);
    // 第 129 轮：同一构建、同一台机器上，点开灯箱实测会在 16 / 184 / 576 ms 之间跳
    // （冷启动的图片解码 + 采集时的帧调度）。单次采样不能下结论，跑 N 轮后按中位数判定，
    // 同时保留首轮（冷启动）与最快值——公司详见 scripts/lib/inp-aggregate.mjs。
    const rounds = [];
    for (let round = 0; round < Math.max(1, repeat); round += 1) {
      rounds.push(await clickThrough(page, mobile));
    }
    const aggregated = [...aggregateRounds(rounds).values()];
    report.push({ path, interactions: aggregated, errors, status, frameMs });
  }
  await browser.close();
  return report;
}

const summarize = (report) => {
  const rows = [];
  for (const page of report) {
    // 标了 skipped 的动作（比如灯箱压根没打开）不参与「最慢」评选：0 ms 会冒充成优等生
    const worst = worstOf(page.interactions);
    const rawMs = Number.isFinite(worst?.median) ? worst.median : (worst?.ms ?? 0);
    // 扣掉环境底噪：本地 headless 上这个页面本来就 ~150 ms 一帧
    const frameMs = page.frameMs ?? 0;
    const worstMs = Math.max(0, Math.round(rawMs - Math.max(0, frameMs - 16)));
    rows.push({
      path: page.path,
      status: page.status ?? 200,
      worstMs,
      rawMs,
      frameMs,
      worstAction: worst?.action ?? "—",
      detail:
        page.interactions
          .map((i) => `${i.action}:${i.skipped ? "跳过" : `${i.median}ms（首轮 ${i.first} / 最快 ${i.min}）`}`)
          .join(" · ") || "无可点元素",
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
    const baseline = row.frameMs > 32 ? `  [本机基线 ${row.frameMs} ms/帧 → 原始 ${row.rawMs} ms]` : "";
    console.log(`${verdict} ${row.path.padEnd(24)} 最慢 ${String(row.worstMs).padStart(4)} ms  (${row.worstAction})${baseline}`);
    console.log(`     ${row.detail}`);
    if (row.errors) console.log(`     页面 JS 错误 ${row.errors} 条`);
  }
  const measured = rows.filter((r) => r.status === 200);
  const skipped = rows.length - measured.length;
  const missing = rows.filter((r) => r.status !== 200);
  const bad = measured.filter((r) => r.worstMs > 200);
  if (skipped) console.log(`\n${skipped} 个页面因 HTTP 状态非 200 被跳过（不计入结论）`);
  console.log(bad.length ? `${bad.length} 个页面交互超过 200 ms 目标线` : "全部可测页面交互 ≤200 ms");
  if (args.failOn404 && missing.length) {
    console.error(`\n${missing.length} 个页面不存在（HTTP 非 200）：${missing.map((r) => r.path).join(", ")}`);
    process.exitCode = 1;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) await main();

export { parseArgs, summarize };
