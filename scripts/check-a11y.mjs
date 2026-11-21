/**
 * 双主题可访问性巡检。
 *
 * 为什么需要它：Lighthouse 只测浅色主题（它还停在 prefers-color-scheme 之外，
 * 本站的深色是 html.dark 类切出来的），所以深色主题的对比度一直是盲区——
 * 2026-11 一次巡检就发现板块染料色在近黑底上只有 2.3:1、多个 zinc-500 小字
 * 只有 4.09:1。这个脚本用 axe-core 把两个主题都测一遍。
 *
 * 用法：
 *   node scripts/check-a11y.mjs                        # 默认测线上
 *   BASE_URL=http://127.0.0.1:4321 node scripts/...     # 测本地 dist
 *   node scripts/check-a11y.mjs --fail-on=warning       # 警告也当失败
 *   node scripts/check-a11y.mjs --mobile                # 追加 iPhone 13 视口（窄屏才会溢出的问题）
 *   node scripts/check-a11y.mjs --dist                  # 自己起静态服务打本地 dist（门禁用）
 *   node scripts/check-a11y.mjs --dist --paths=/,/ai/    # 只测这几页（门的快检）
 *   node scripts/check-a11y.mjs --dist --sample=12       # 从 sitemap 分节抽样 12 页（每周巡检用）
 *
 * 为什么要有 `--sample`：手写路径表只能覆盖"我记得的页面"。第 123 轮往 23 条里加了三类，
 * 立刻抓到 `/now/` 嵌套 `<main>` 和留言板焦点环被抹。1188 个 URL 靠人挑 26 个，剩下的
 * 809 个模板实例没人看过 —— 所以按周从 sitemap 确定性抽样补盲。
 *
 * 输出：控制台汇总 + a11y-report.json（CI 里作为 artifact 上传）
 *
 * 规则集：跑 axe 的**全部**默认规则，不再只挑对比度和标题层级。
 * 2026-11-11 第一次全量跑就抓到四类此前从没测过的问题：旅行攻略页嵌套了
 * 第二个 <main>、首页热力图的横向滚动区不可键盘聚焦、主/侧/面包屑三个 <nav>
 * 没有各自的可读名字。全量规则集在 25 个页面类型 × 2 主题上已经是 0 违规。
 */
import fs from "node:fs";
import { chromium, devices } from "playwright";
import axe from "axe-core";

let BASE_URL = process.env.BASE_URL ?? "https://www.zorotreeking.online";

/** 覆盖所有页面模板，而不是只测首页。 */
let PATHS = [
  "/",
  "/en/",
  "/about/",
  "/ai/",
  "/ai/digest/",
  "/ai/digest-2026-06-05/",
  "/invest/",
  "/invest/digest/",
  // 第 133 轮改过四个归档页的结构（最新 6 期大卡片 + 更早紧凑行），英文两页也纳入
  "/en/invest/digest/",
  "/en/ai/digest/",
  "/invest/market/",
  "/hike/",
  "/hike/travel/ali-grand-loop-lhasa-return-2026/",
  "/photo/",
  "/photo/baokemeng/",
  "/explore/",
  "/changelog/",
  "/tag/",
  "/subscribe/",
  // 下面几类是"结构性"问题的高发区：嵌套地标、可滚动区域、图片替代文本
  "/invest/stock/002371.SZ/",
  "/invest/hk-market/",
  "/en/ai/digest-2026-10-11/",
  // 日报详情 / 市场复盘详情：模板和列表页不同（h2/h3 标题、em 时间戳、已读标记），
  // 2026-11 的深色对比度问题就是这两个模板独有的，之前没进抽查范围
  "/invest/digest-2026-11-10/",
  "/invest/market-recap-2026-11-10/",
  "/hike/travel/chuanxi-loop-chengdu-2026/",
  // 第 123 轮补的长期缺口：这三类页面一直没被抽查过，而它们各有各的坑
  //   /now/          —— 只有一页、以长列表 + 状态标签为主（颜色承载信息）
  //   /guestbook/    —— 只有一个外链组件（无 JS 时是什么样）
  //   /en/invest/market-recap-*  —— 机翻页 + 顶部机器翻译声明（新加的横幅会不会破坏可读性）
  "/now/",
  "/guestbook/",
  "/en/invest/market-recap-2026-11-13/",
  // 第 126 轮：地图从"自动加载 Leaflet"改成年"点一下才加载"，这条路径守着新按钮与预览态
  "/hike/sample-route/",
];

const args = process.argv.slice(2);
const MOBILE = args.includes("--mobile");

// --dist：不依赖有人先起服务，自己把 dist 挂起来（门禁里这么用，和 check-search 一致）
const distArg = args.find((arg) => arg === "--dist" || arg.startsWith("--dist="));
if (distArg) {
  const { serveDist } = await import("./lib/serve-dist.mjs");
  const root = distArg.includes("=") ? distArg.slice("--dist=".length) : "dist";
  const server = await serveDist(root);
  BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.on("exit", () => server.close());
}

// --paths：只测指定页面。门禁里用它跑一个「模板级」快检（全站 46 次检查要 2.5 分钟）
// --sample=N：从 sitemap 分节抽样（门禁外的每周巡检用；seed 默认取 ISO 周，保证一周内稳定）
const sampleArg = args.find((arg) => arg.startsWith("--sample="));
if (sampleArg) {
  const count = Number(sampleArg.slice("--sample=".length));
  if (!Number.isFinite(count) || count < 1) {
    console.error("✗ --sample= 需要一个正整数");
    process.exit(2);
  }
  const seedArg = args.find((arg) => arg.startsWith("--seed="));
  const seed = seedArg ? seedArg.slice("--seed=".length) : new Date().toISOString().slice(0, 10);
  const sitemapPath = args.find((arg) => arg.startsWith("--sitemap="))?.slice("--sitemap=".length) ?? "dist/sitemap.xml";
  const { urlsFromSitemap, samplePaths } = await import("./lib/a11y-sample.mjs");
  let xml;
  try {
    xml = fs.readFileSync(sitemapPath, "utf8");
  } catch {
    console.error(`✗ 读不到 sitemap：${sitemapPath}（先 npm run build）`);
    process.exit(2);
  }
  PATHS = samplePaths(urlsFromSitemap(xml), { count, seed });
  console.log(`抽样：seed=${seed}，从 sitemap 选 ${PATHS.length} 页（分节轮转）`);
  for (const path of PATHS) console.log(`  · ${path}`);
  // --dry-run：只抽样不加载页面（本地/CI 都能秒验抽样是否正常，不用等两分钟跑完）
  if (args.includes("--dry-run")) process.exit(0);
}

const pathsArg = args.find((arg) => arg.startsWith("--paths="));
if (pathsArg) {
  const picked = pathsArg.slice("--paths=".length).split(",").map((p) => p.trim()).filter(Boolean);
  if (picked.length === 0) {
    console.error("✗ --paths= 至少要给一个路径");
    process.exit(2);
  }
  const unknown = picked.filter((p) => !PATHS.includes(p));
  if (unknown.length > 0) {
    console.error(`✗ --paths 里有不在规则集里的路径：${unknown.join(" ")}（可选：${PATHS.join(" ")}）`);
    process.exit(2);
  }
  PATHS = picked;
}
/** 桌面 1280×900 一定有；--mobile 追加 iPhone 13（390×844，带触摸）。 */
const VIEWPORTS = [
  { id: "desktop", options: { viewport: { width: 1280, height: 900 } } },
  ...(MOBILE ? [{ id: "mobile", options: { ...devices["iPhone 13"] } }] : []),
];
const failOn = (args.find((a) => a.startsWith("--fail-on=")) ?? "--fail-on=error").split("=")[1];

/** 本地通常没装 Playwright 自带 chromium（用的是系统 Chrome），CI 里则会装。 */
async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

const browser = await launch();
const report = { baseUrl: BASE_URL, startedAt: new Date().toISOString(), results: [] };
let failures = 0;
let warnings = 0;

for (const viewport of VIEWPORTS) {
for (const path of PATHS) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage(viewport.options);
    const entry = { path, theme, viewport: viewport.id, ok: true, violations: [] };
    try {
      await page.goto(BASE_URL + path, { waitUntil: "networkidle", timeout: 60_000 });
      if (theme === "dark") {
        await page.evaluate(() => {
          document.documentElement.classList.add("dark");
          document.documentElement.style.colorScheme = "dark";
        });
      }
      // 两个坑叠在一起（第 83 轮定位）：
      //  1. 入场动画（animate-rise 0.8s）半透明中间态会被当成对比度不足 —— 等它跑完；
      //  2. 更阴的一个：列表页有 170 张卡在**首屏之外**，而它们带 `transition-colors`。
      //     Chromium 对「从未被绘制过」的元素不推进 transition，getComputedStyle 会一直
      //     返回过渡起点（浅色的 #fff），于是 axe 报出 162 条「深色主题下浅灰字压白底」。
      //     手动滚进视口后同一元素立刻变成 rgba(24,24,27,.4) —— 说明站点是对的、测量是错的。
      // 关掉过渡/动画让计算值一步到位，不依赖元素有没有被绘制。
      await page.addStyleTag({
        content: `*, *::before, *::after {
          transition: none !important;
          animation: none !important;
        }`,
      });
      await page.waitForTimeout(2500);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        // 不传 runOnly：跑 axe 全部默认规则
        const r = await window.axe.run(document, { resultTypes: ["violations"] });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          count: v.nodes.length,
          nodes: v.nodes.slice(0, 5).map((n) => ({
            target: n.target.join(" "),
            reason: (n.any[0]?.message ?? "").replace(/\s+/g, " ").slice(0, 240),
          })),
        }));
      });

      entry.violations = violations;

      // 键盘焦点环：axe 不检查这个，但它是 WCAG 2.4.7 的硬要求。
      // 2026-11-11 之前有 14 处 outline-none 把浏览器默认环抹掉了，
      // 其中邮箱输入框的焦点环是 rgba(0,0,0,0)（等于隐形）。
      if (theme === "light") {
        const missing = [];
        // Tab 必须由 Playwright 真按：:focus-visible 只在真实键盘交互后生效，
        // 页面内 el.focus() 触发不了它（那样测出来永远"没有环"是假绿）。
        // 12 个不够：订阅页的邮箱输入框是第 15 个 tab stop，而它正是
        // 之前唯一一个焦点环被 outline-none 抹成透明的控件。
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press("Tab");
          const res = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(cs.outlineColor);
            // Tailwind 的 ring-* 用 box-shadow 实现，也是合法的焦点指示（WCAG 2.4.7 只看"看得见"）
            const ring = cs.boxShadow && !/^none$/.test(cs.boxShadow) && !/rgba\(0, 0, 0, 0\)/.test(cs.boxShadow);
            const invisible = !ring && (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) === 0 || transparent);
            const label = el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 18) || el.getAttribute("placeholder") || "";
            return { invisible, label: `${el.tagName.toLowerCase()}${label ? `:${label}` : ""}` };
          });
          if (!res) break;
          if (res.invisible) missing.push(res.label);
        }
        if (missing.length) {
          violations.push({
            id: "focus-visible-missing",
            impact: "serious",
            count: missing.length,
            nodes: missing.slice(0, 5).map((target) => ({ target, reason: "键盘焦点没有可见指示" })),
          });
        }
        entry.focusChecked = 30;
      }

      entry.violations = violations;
      if (entry.violations.length) {
        entry.ok = false;
        const isError = entry.violations.some((v) => v.impact === "serious" || v.impact === "critical");
        if (isError || failOn === "warning") failures += 1;
        else warnings += 1;
      }
    } catch (err) {
      entry.ok = false;
      entry.error = String(err).slice(0, 300);
      failures += 1;
    } finally {
      await page.close();
    }
    report.results.push(entry);

    const mark = entry.ok ? "✓" : "✗";
    const detail = entry.error
      ? `错误: ${entry.error}`
      : entry.violations.map((v) => `${v.id}×${v.count}`).join(" ");
    const tag = viewport.id === "mobile" ? "📱 " : "";
    console.log(`${mark} ${tag}${theme.padEnd(5)} ${path}${detail ? "  " + detail : ""}`);
    for (const v of entry.violations) {
      for (const n of v.nodes) console.log(`      ${n.target} — ${n.reason}`);
    }
  }
}
}

await browser.close();
report.finishedAt = new Date().toISOString();
report.summary = { total: report.results.length, failures, warnings };
fs.writeFileSync("a11y-report.json", JSON.stringify(report, null, 2));

console.log(
  `\n${report.summary.total} 次检查：${failures} 失败 / ${warnings} 警告（--fail-on=${failOn}）→ a11y-report.json`,
);
process.exit(failures > 0 ? 1 : 0);
