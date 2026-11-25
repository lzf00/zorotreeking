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
 *   node scripts/check-a11y.mjs --dist --templates       # 构建产物里每个路由模板各测首末页（第 193 轮）
 *   node scripts/check-a11y.mjs --dist --templates --template-window=3/7   # 只测第 3/7 份（每周巡检轮转）
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
  // 第 134 轮：标签页改成「最新 20 篇详细 + 更早紧凑行」，条目最多的标签页也纳入
  "/tag/auto/",
  "/en/tag/auto/",
  "/invest/market/",
  // 第 181 轮：全站审计（1190 页 × 浅/深）唯一的违规就在这一页 —— 而它此前不在抽查规则集里，
  // 所以门禁一直是绿的。「hawkish 时卡片带 rose 着色」让 tertiary 灰压在上面只有 ~3:1。
  "/invest/us-market/",
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
  // 第 145 轮：英文留言板此前没进规则集 —— 表单控件的可读名检查抓到中文页有 3 个未关联 label，
  // 英文模板是同一段组件，必须一起验
  "/en/guestbook/",
  "/en/invest/market-recap-2026-11-13/",
  // 第 126 轮：地图从"自动加载 Leaflet"改成年"点一下才加载"，这条路径守着新按钮与预览态
  "/hike/sample-route/",
  // 第 187 轮：`/search/` 从 404 变成真页面 —— 输入框 + 结果链接 + 空状态文案，
  // 而且它是**唯一**一个把搜索岛当页面主体渲染的模板（浮层那套的语义不适用）
  "/search/",
  // 第 188 轮：英文搜索页是同一套岛、不同文案 —— i18n 最容易把 label 弄丢，
  // 英文文本框的可读名检查必须真跑一次
  "/en/search/",
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

/**
 * --templates（第 193 轮）：从构建产物反推**路由模板**，每个模板测第一页 + 最后一页。
 *
 * 手写 PATHS 表跟不上的问题在这站反复发生（第 123/133/134/181/187 轮，以及第 189–192 轮
 * 新增的 4 族分页页）。改成从 dist 反推后，新模板**自动**进入审计范围；
 * 手写表继续作为"额外定点页"叠加。
 */
if (args.includes("--templates")) {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { pickTemplateSamples, templateWindow } = await import("./lib/a11y-templates.mjs");
  const walk = (dir, base = "") => {
    const out = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = `${base}/${name}`;
      if (statSync(full).isDirectory()) out.push(...walk(full, rel));
      else if (name === "index.html") out.push(`${base}/`);
    }
    return out;
  };
  let all;
  try {
    all = walk("dist");
  } catch {
    console.error("✗ 读不到 dist（先 npm run build）");
    process.exit(2);
  }
  // 跳转桩（/photography/ → /photo/）没有内容；/admin/ 是 Decap CMS 的客户端壳（noindex、
  // 只有站长自己用），它的第三方 UI 违规不是本站的模板问题 —— 两类都不参与审计。
  all = all.filter((p) => !p.startsWith("/admin/"));
  all = all.filter((p) => {
    try {
      return !/<title>Redirecting to /.test(fs.readFileSync(`dist${p}index.html`, "utf8"));
    } catch {
      return false;
    }
  });
  let picked = pickTemplateSamples(all);
  // --template-window=K/N：只测其中一份（每周巡检轮转，N 周覆盖全部模板）
  const windowArg = args.find((a) => a.startsWith("--template-window="));
  if (windowArg) {
    const raw = windowArg.slice("--template-window=".length);
    const [k, n] = raw.split("/").map(Number);
    // 巡检脚本默认取本周（ISO 周）那一份；给了 K/N 就用给的
    picked = templateWindow(picked, { index: Number.isFinite(k) ? k : 0, of: Number.isFinite(n) && n > 0 ? n : 7 });
    console.log(`模板窗口：${raw} → ${picked.length} 个实例`);
  }
  PATHS = [...new Set([...PATHS, ...picked])];
  console.log(`模板抽样：${all.length} 个页面 → ${picked.length} 个模板实例（首末页）`);
  if (args.includes("--dry-run")) {
    for (const path of picked) console.log(`  · ${path}`);
    process.exit(0);
  }
}

const pathsArg = args.find((arg) => arg.startsWith("--paths="));
if (pathsArg) {
  const picked = pathsArg.slice("--paths=".length).split(",").map((p) => p.trim()).filter(Boolean);
  if (picked.length === 0) {
    console.error("✗ --paths= 至少要给一个路径");
    process.exit(2);
  }
  // 第 193 轮：不再要求路径出现在手写表里 —— 那个限制让"临时补测一个分页页"变成改代码。
  // 现在只校验它确实构建出来了（拼错路径会静默变成 404 页面，测了个寂寞）。
  const missing = picked.filter((p) => !fs.existsSync(`dist${p}index.html`) && !fs.existsSync(`dist${p}`));
  if (missing.length > 0) {
    console.error(`✗ --paths 里有构建产物里不存在的路径：${missing.join(" ")}（先 npm run build，或检查拼写）`);
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
      const noMotionStyle = await page.addStyleTag({
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

        // 搜索对话框的键盘契约（第 140 轮）。
        // axe 查不出这类问题：焦点陷阱、焦点归还是**行为**，不是标记。
        // 实测修复前：按两次 Tab 焦点就跑到背后的页面链接上，Esc 关闭后焦点掉到 <body>。
        if (path === "/") {
          const issues = [];
          const trigger = page.locator("[data-search-trigger]").first();
          if ((await trigger.count()) === 0) {
            issues.push({ target: "[data-search-trigger]", reason: "首页找不到搜索入口，无法验证对话框" });
          } else {
            await trigger.click();
            await page.waitForSelector('[role="dialog"]', { timeout: 15_000 });
            await page.waitForTimeout(400);
            const modal = await page.evaluate(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return {
                ariaModal: dialog?.getAttribute("aria-modal"),
                inputLabel: dialog?.querySelector("input")?.getAttribute("aria-label") ?? "",
                hasStatus: Boolean(dialog?.querySelector('[role="status"]')),
              };
            });
            if (modal.ariaModal !== "true") issues.push({ target: '[role="dialog"]', reason: '缺少 aria-modal="true"' });
            if (!modal.inputLabel) issues.push({ target: '[role="dialog"] input', reason: "搜索输入框没有可读标签" });
            if (!modal.hasStatus) issues.push({ target: '[role="dialog"]', reason: "结果变化没有 aria-live 播报" });
            for (let i = 0; i < 6; i += 1) {
              await page.keyboard.press("Tab");
              const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
              if (!inside) {
                issues.push({ target: '[role="dialog"]', reason: `按 ${i + 1} 次 Tab 后焦点跑出对话框（缺焦点陷阱）` });
                break;
              }
            }
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            // 注意要用 activeElement 的祖先判断：页面上有多个搜索入口（顶栏/页脚/首页），
            // querySelector 取到的是 DOM 里第一个，未必是刚点的那个（第 140 轮踩过）
            const restored = await page.evaluate(() =>
              Boolean(document.activeElement?.closest("[data-search-trigger], #open-search, #home-search-trigger")),
            );
            if (!restored) issues.push({ target: "[data-search-trigger]", reason: "关闭后焦点没有回到触发按钮" });
          }
          if (issues.length) {
            violations.push({
              id: "search-dialog-keyboard",
              impact: "serious",
              count: issues.length,
              nodes: issues.map((issue) => ({ target: issue.target, reason: issue.reason })),
            });
          }
          entry.dialogChecked = true;

          // AI 助手浮层的键盘契约（第 142 轮）。它和前两个不同：**非模态**，
          // 不设 aria-modal、也不做焦点陷阱（要能一边聊一边读页面），
          // 只需保证"进得去、出得来"。修复前实测：打开后焦点还在 <body>，Tab 直接走到页面链接。
          const chatIssues = [];
          const chatLauncher = page.locator("#ai-chat-launcher, [aria-controls=\"ai-chat-panel\"]").first();
          if ((await chatLauncher.count()) === 0) {
            chatIssues.push({ target: "#ai-chat-launcher", reason: "首页找不到 AI 助手入口" });
          } else {
            await chatLauncher.click();
            await page.waitForSelector("#ai-chat-panel", { timeout: 20_000 });
            await page.waitForTimeout(900);
            const chat = await page.evaluate(() => {
              const panel = document.querySelector("#ai-chat-panel");
              return {
                focusInPanel: Boolean(document.activeElement?.closest("#ai-chat-panel")),
                hasLog: Boolean(panel?.querySelector('[role="log"]')),
                inputLabel: panel?.querySelector("textarea")?.getAttribute("aria-label") ?? "",
              };
            });
            if (!chat.focusInPanel) chatIssues.push({ target: "#ai-chat-panel", reason: "打开后焦点没有进入面板" });
            if (!chat.hasLog) chatIssues.push({ target: "#ai-chat-panel", reason: "对话记录没有 role=log，读屏不播报新消息" });
            if (!chat.inputLabel) chatIssues.push({ target: "#ai-chat-panel textarea", reason: "输入框没有可读标签" });
            await page.keyboard.press("Escape");
            await page.waitForTimeout(400);
            const back = await page.evaluate(() =>
              Boolean(document.activeElement?.closest("[aria-controls=\"ai-chat-panel\"]")),
            );
            if (!back) chatIssues.push({ target: "#ai-chat-panel", reason: "关闭后焦点没有回到悬浮按钮" });
          }
          if (chatIssues.length) {
            violations.push({
              id: "chat-panel-keyboard",
              impact: "serious",
              count: chatIssues.length,
              nodes: chatIssues.map((issue) => ({ target: issue.target, reason: issue.reason })),
            });
          }
          entry.chatChecked = true;
        }

        // 照片灯箱的键盘契约（第 141 轮）：同样是 axe 测不出的行为问题。
        // 修复前实测：点开后焦点还留在背后的照片链接上、没有 aria-modal、
        // Tab 走完 4 个按钮后跑到 BODY。Esc 关闭与方向键是 PhotoSwipe 本来就对的，只验前三条。
        if (path === "/photo/baokemeng/") {
          const issues = [];
          const photo = page.locator("a[data-pswp-width]").first();
          if ((await photo.count()) === 0) {
            issues.push({ target: "a[data-pswp-width]", reason: "相册里找不到可点开的照片" });
          } else {
            // 先把"禁用过渡"的样式摘掉：它是为了量对比度注入的，但会让 PhotoSwipe 的
            // 关闭动画永远等不到 transitionend，于是"关闭"根本不完成 —— 这是测量手段
            // 造成的假故障（真实用户走的是站点自己的 prefers-reduced-motion：0.01ms，
            // 事件照样会触发）。
            await noMotionStyle.evaluate((element) => element.remove());
            await photo.click();
            await page.waitForSelector(".pswp", { timeout: 15_000 });
            await page.waitForTimeout(800);
            const state = await page.evaluate(() => {
              const root = document.querySelector(".pswp");
              return {
                ariaModal: root?.getAttribute("aria-modal"),
                focusIn: Boolean(document.activeElement?.closest(".pswp")),
              };
            });
            if (state.ariaModal !== "true") issues.push({ target: ".pswp", reason: '灯箱缺少 aria-modal="true"' });
            if (!state.focusIn) issues.push({ target: ".pswp", reason: "打开后焦点没有移进灯箱" });
            for (let i = 0; i < 6; i += 1) {
              await page.keyboard.press("Tab");
              const inside = await page.evaluate(() => Boolean(document.activeElement?.closest(".pswp")));
              if (!inside) {
                issues.push({ target: ".pswp", reason: `按 ${i + 1} 次 Tab 后焦点跑出灯箱（缺焦点陷阱）` });
                break;
              }
            }
            await page.keyboard.press("Escape");
            await page.waitForTimeout(600);
            const restored = await page.evaluate(() =>
              Boolean(document.activeElement?.closest("a[data-pswp-width], figure a, .grid a")),
            );
            if (!restored) issues.push({ target: "a[data-pswp-width]", reason: "关闭后焦点没有回到照片" });
          }
          if (issues.length) {
            violations.push({
              id: "lightbox-keyboard",
              impact: "serious",
              count: issues.length,
              nodes: issues.map((issue) => ({ target: issue.target, reason: issue.reason })),
            });
          }
          entry.lightboxChecked = true;
        }
      }

      // 表单控件的可读名称（第 143 轮）。axe 的 label 规则对"只有 placeholder"的
      // 输入框实测**不报**（在 /subscribe/ 上抹掉 aria-label 复跑，violations 与 incomplete 都是空），
      // 但读屏用户听到的是一个没有名字的输入框 —— 所以自己断言。
      // placeholder 不算名字（它会在输入时消失，而且不是 label）。
      if (theme === "light") {
        const unlabeled = await page.evaluate(() => {
          const nameOf = (el) => {
            const aria = el.getAttribute("aria-label");
            if (aria && aria.trim()) return aria.trim();
            const byId = el.getAttribute("aria-labelledby");
            if (byId) {
              const text = byId.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
              if (text) return text;
            }
            if (el.id) {
              const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
              if (label?.textContent?.trim()) return label.textContent.trim();
            }
            const wrap = el.closest("label");
            if (wrap?.textContent?.trim()) return wrap.textContent.trim();
            if (el.getAttribute("title")?.trim()) return el.getAttribute("title").trim();
            return "";
          };
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
          };
          return [...document.querySelectorAll("input:not([type=hidden]), textarea, select")]
            .filter((el) => visible(el) && !nameOf(el))
            .map((el) => `${el.tagName.toLowerCase()}#${el.id || el.getAttribute("name") || "?"}[placeholder=${el.getAttribute("placeholder") ?? "-"}]`);
        });
        if (unlabeled.length) {
          violations.push({
            id: "form-field-no-name",
            impact: "serious",
            count: unlabeled.length,
            nodes: unlabeled.slice(0, 5).map((target) => ({ target, reason: "表单控件没有可读名称（只有 placeholder 不算）" })),
          });
        }
        entry.formFieldsChecked = true;
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
