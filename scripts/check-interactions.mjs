#!/usr/bin/env node
/**
 * 交互自检：页面加载不报错 ≠ 交互不报错。
 *
 * `check-runtime.mjs` 只验证「打开页面」这条路径。但本站的交互都在 island 里：
 * 相册灯箱（PhotoSwipe）、搜索弹窗、点赞、深浅色切换。这些代码只有在真的点下去
 * 才会执行——水合失败、事件没绑上、API 返回结构不对，静态检查全都看不见。
 *
 * 场景（中英各一套）：
 *   1. 搜索：点搜索按钮 → 输入关键词 → 结果里有链接 → Esc 关闭
 *   2. 灯箱：点相册首图 → `.pswp--open` 出现 → Esc 关闭
 *   3. 点赞：点「喜欢 / Like」→ 按钮进入按下态（aria-pressed 或文案变化）
 *   4. 主题：点主题按钮 → <html> 的 dark 类翻转
 *
 * 每个场景除了断言 DOM 状态，还捕获 pageerror / console.error / 同源 4xx。
 * 退出码：0 通过、1 有场景失败、2 环境不可用（dist 未构建 / 浏览器缺失）。
 *
 * 用法：
 *   node scripts/check-interactions.mjs
 *   node scripts/check-interactions.mjs --only=search --wait=2000
 *   node scripts/check-interactions.mjs --dist=dist
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isThirdPartyConsoleNoise } from "./lib/console-noise.mjs";
import { makeContextHermetic } from "./lib/hermetic.mjs";
import { chromePath, serveDist } from "./lib/serve-dist.mjs";

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const DIST = path.resolve(valueOf("dist", "dist"));
const ONLY = valueOf("only", "");
const WAIT = Number(valueOf("wait", "1200"));
const KEYWORD = valueOf("keyword", "GDP");

/** 每个场景：给一个 url，做一串动作，最后断言；返回失败原因数组（空 = 通过） */
const SCENARIOS = [
  {
    name: "搜索弹窗（中文）",
    url: "/",
    async run({ page, fail, openSearch }) {
      const input = await openSearch('button[aria-label="搜索"]');
      if (!input) return fail("点开搜索后没有出现输入框（island 没水合？）");
      await input.fill(KEYWORD);
      await page.waitForTimeout(WAIT);
      // 结果就是弹窗里的 <a>（pagefind 结果不分 class）
      const results = await page.locator('[role="dialog"] a[href]').count();
      if (results === 0) return fail(`输入「${KEYWORD}」后没有搜索结果链接`);
      // 第 214 轮：每条结果头上要有「板块 · 类型 · 日期」。1068 页自动产出的标题几乎一样，
      // 没有这一行读者分不清挑哪条（这是纯展示层，不碰索引）。
      //
      // 用 evaluate 数而不是链式 locator：`a[href] >> text=/…/` 在不同 Playwright 版本和
      // 不同 dist 上的匹配语义会把这里变成假失败（第 214 轮 CI 就是这么红的）。
      const labelled = await page.evaluate(() => {
        const KIND = /(·\s*\d{4}-\d{2}-\d{2})|日报|复盘|周报|笔记|Photography|Site page|AI digest/;
        return [...document.querySelectorAll('[role="dialog"] a[href]')].filter((a) => {
          const first = a.querySelector("div");
          return first && KIND.test(first.textContent || "");
        }).length;
      });
      if (labelled === 0) return fail("搜索结果没有「板块 · 类型 · 日期」标签");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      if (await page.locator("input[type=text]").first().isVisible()) return fail("Esc 没有关闭搜索弹窗");
    },
  },
  {
    name: "搜索弹窗（英文）",
    url: "/en/",
    async run({ page, fail, openSearch }) {
      const input = await openSearch('button[aria-label="Search"], button[aria-label="搜索"]');
      if (!input) return fail("点开搜索后没有出现输入框（island 没水合？）");
      await input.fill(KEYWORD);
      await page.waitForTimeout(WAIT);
      if ((await page.locator('[role="dialog"] a[href]').count()) === 0) return fail("没有搜索结果链接");
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "相册灯箱（中文）",
    url: "/photo/baokemeng/",
    async run({ page, fail }) {
      const first = page.locator('[id^="gallery-"] a').first();
      if ((await first.count()) === 0) return fail("画廊里没有可点的图片");
      await first.click();
      await page.waitForTimeout(WAIT);
      const pswp = page.locator(".pswp.pswp--open");
      if ((await pswp.count()) === 0) return fail("点击图片后没有出现 PhotoSwipe 灯箱（.pswp--open）");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
      if ((await page.locator(".pswp.pswp--open").count()) > 0) return fail("Esc 没有关闭灯箱");
    },
  },
  {
    name: "相册灯箱（英文）",
    url: "/en/photo/baokemeng/",
    async run({ page, fail }) {
      const first = page.locator('[id^="gallery-"] a').first();
      if ((await first.count()) === 0) return fail("画廊里没有可点的图片");
      await first.click();
      await page.waitForTimeout(WAIT);
      if ((await page.locator(".pswp.pswp--open").count()) === 0) return fail("灯箱没打开");
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "点赞按钮",
    url: "/photo/baokemeng/",
    async run({ page, fail, apiCalls }) {
      const like = page.locator('button[aria-label="喜欢"], button[aria-label="Like"]').first();
      if ((await like.count()) === 0) return fail("找不到点赞按钮");
      // 初始点赞数来自 GET /api/feedback（这里是 stub 返回 3/1）
      await page.waitForTimeout(800);
      await like.click();
      await page.waitForTimeout(WAIT);
      if ((await like.getAttribute("aria-pressed")) !== "true") return fail("点赞后 aria-pressed 不是 true（乐观更新没生效或已回滚）");
      if (!apiCalls.some((call) => call.method === "POST" && call.url.includes("/api/feedback"))) {
        return fail("点击后没有发出 POST /api/feedback");
      }
    },
  },
  {
    // 第 86 轮：内容页原来有 15–20 个反馈岛，每个挂载即 GET /api/feedback，
    // 一个 digest 页面开局就发 21 个请求。改成按需加载后应该 ≤2（含鼠标恰好停在按钮上）。
    // 这条守住「别再退回挂载即请求」。
    name: "内容页：滚动一遍不预取整页反馈（≤2 次 GET）",
    url: "/ai/digest-2026-08-27/",
    async run({ page, fail, apiCalls }) {
      const buttons = await page.locator('button[aria-label="喜欢"]').count();
      if (buttons < 5) return fail(`该页面应有多个反馈按钮，实际只有 ${buttons} 个`);
      // 必须像人一样滚一遍：反馈岛是 client:visible，不滚进视口根本不会挂载，
      // 那样就测不到「挂载即请求」这个回归点（第 87 轮踩过：不滚的时候这条永远是绿的）。
      await page.evaluate(async () => {
        const step = 400;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let y = 0; y <= document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await sleep(60);
        }
      });
      await page.waitForTimeout(1500);
      const gets = apiCalls.filter((call) => call.method === "GET" && call.url.includes("/api/feedback")).length;
      if (gets > 2) return fail(`滚动后发了 ${gets} 次 GET /api/feedback（按需加载后应 ≤2）`);
    },
  },
  {
    // 线上 /api/feedback 的 GET 一直是 422（第 83 轮发现）。第 86 轮改成按需加载后，
    // 如果「加载失败就不投票」，按钮会彻底点不动 —— 这条守住降级路径。
    name: "反馈 GET 422 时点击仍能投票（降级不阻塞）",
    url: "/photo/baokemeng/",
    api: {
      "/api/feedback": (call, request) =>
        request.method() === "GET"
          ? { status: 422, body: { detail: "unprocessable" } }
          : { status: 200, body: { likes: 1, dislikes: 0, my_vote: "like" } },
    },
    async run({ page, fail, apiCalls }) {
      const like = page.locator('button[aria-label="喜欢"], button[aria-label="Like"]').first();
      if ((await like.count()) === 0) return fail("找不到点赞按钮");
      await like.click();
      await page.waitForTimeout(WAIT);
      if ((await like.getAttribute("aria-pressed")) !== "true") {
        return fail("GET 422 后点击没有进入按下态（推荐的降级路径失效，按钮点不动了）");
      }
      if (!apiCalls.some((call) => call.method === "POST" && call.url.includes("/api/feedback"))) {
        return fail("GET 422 后没有继续发 POST /api/feedback");
      }
    },
  },
  {
    // 与反馈按钮同一个坑的另一半：StarRating 原来挂载即拉汇总，GET 422 时在每篇
    // 文章底部渲染红色「· HTTP 422」。现在挂载不拉、悬停才拉，且失败静默。
    name: "评分：GET 422 时点星仍能评分且不显示错误徽标",
    url: "/ai/digest-2026-08-27/",
    api: {
      "/api/feedback": (call, request) =>
        request.method() === "GET"
          ? { status: 422, body: { detail: "unprocessable" } }
          : { status: 200, body: { likes: 2, dislikes: 0, my_vote: "like" } },
    },
    async run({ page, fail, apiCalls }) {
      const group = page.locator('[role="radiogroup"]').first();
      if ((await group.count()) === 0) return fail("找不到星级评分控件");
      // 评分岛是 client:visible：不滚进视口就不会水合，点了也不理你
      await group.scrollIntoViewIfNeeded();
      await group.evaluate(async (el) => {
        const island = el.closest("astro-island");
        for (let i = 0; i < 40; i += 1) {
          if (!island || !island.hasAttribute("ssr")) return;
          await new Promise((r) => setTimeout(r, 150));
        }
      });
      const star = group.locator("button").nth(3);
      await star.click();
      await page.waitForTimeout(WAIT);
      if ((await star.getAttribute("aria-checked")) !== "true") return fail("点击第 4 颗星后没进入选中态");
      if (!apiCalls.some((call) => call.method === "POST" && call.url.includes("/api/feedback"))) {
        return fail("评分没有发出 POST /api/feedback");
      }
      // 关键：GET 失败不许在页面上留下「HTTP 422」字样
      const text = await page.locator("body").innerText();
      if (/HTTP 422|HTTP 4\d\d/.test(text)) return fail("页面上出现了错误码徽标（初始加载失败应当静默）");
    },
  },
  {
    name: "键盘 / 唤起搜索",
    url: "/",
    async run({ page, fail }) {
      // 桌面用户最常用的入口之一：不在输入框里按 / 直接开搜索。
      // 第一次按下要先把 modal 的 chunk 拉下来，所以给足等待时间。
      await page.keyboard.press("/");
      let input = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.waitForTimeout(300);
        const candidate = page.locator("input[type=text]").first();
        if ((await candidate.count()) > 0) { input = candidate; break; }
      }
      if (!input) return fail("按 / 没有唤起搜索弹窗");
      const focused = await page.evaluate(() => document.activeElement?.tagName === "INPUT");
      if (!focused) return fail("按 / 后输入框没有自动聚焦（用户还得再点一下）");
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "手机搜索（390 宽）",
    url: "/",
    viewport: { width: 390, height: 844 },
    async run({ page, fail, openSearch }) {
      const input = await openSearch('button[aria-label="搜索"]');
      if (!input) return fail("手机上点搜索按钮没有出现输入框");
      await input.fill(KEYWORD);
      await page.waitForTimeout(WAIT);
      if ((await page.locator('[role="dialog"] a[href]').count()) === 0) return fail("手机上搜索没有结果");
    },
  },
  {
    name: "手机灯箱（390 宽）",
    url: "/photo/baokemeng/",
    viewport: { width: 390, height: 844 },
    async run({ page, fail }) {
      const first = page.locator('[id^="gallery-"] a').first();
      if ((await first.count()) === 0) return fail("手机上画廊里没有可点的图片");
      await first.tap();
      await page.waitForTimeout(WAIT);
      if ((await page.locator(".pswp.pswp--open").count()) === 0) return fail("手机上点图没出灯箱");
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "手机灯箱关闭按钮",
    url: "/photo/baokemeng/",
    viewport: { width: 390, height: 844 },
    async run({ page, fail }) {
      const first = page.locator('[id^="gallery-"] a').first();
      if ((await first.count()) === 0) return fail("手机上画廊里没有可点的图片");
      await first.tap();
      await page.waitForTimeout(WAIT);
      if ((await page.locator(".pswp.pswp--open").count()) === 0) return fail("灯箱没打开");
      // 真机上没人按 Esc：点右上角 × 才是主要关闭路径
      const close = page.locator(".pswp__button--close").first();
      if ((await close.count()) === 0) return fail("灯箱里找不到关闭按钮（.pswp__button--close）");
      await close.tap();
      await page.waitForTimeout(800);
      if ((await page.locator(".pswp.pswp--open").count()) > 0) return fail("点 × 没有关闭灯箱");
    },
  },
  {
    name: "ETF 接口失败 → 重试成功（手机视口）",
    url: "/invest/etf/",
    viewport: { width: 390, height: 844 },
    api: {
      "/api/market/etf": (call) =>
        call === 0
          ? { status: 500, body: { ok: false, error: "上游行情接口不可用" } }
          : {
              status: 200,
              body: {
                ok: true,
                ts: Date.now(),
                items: [
                  { code: "999999", name: "桩数据ETF", price: 4.321, change_pct: 1.23, turnover_yi: 18.4, prev_turnover_yi: 22.1, ratio_pct: 83.2 },
                ],
              },
            },
    },
    async run({ page, fail }) {
      // 首屏数据先失败：必须给出可点的重试入口，而不是一片空白
      await page.waitForTimeout(WAIT);
      const retry = page.locator("button", { hasText: "重试" }).first();
      if ((await retry.count()) === 0) return fail("接口 500 后没有出现「重试」按钮");
      await retry.click();
      await page.waitForTimeout(WAIT);
      if ((await page.getByText("桩数据ETF").count()) === 0) return fail("点重试后没有渲染出接口返回的 ETF 数据");
      const body = await page.locator("body").innerText();
      if (!/18\.4\s*亿/.test(body)) return fail("ETF 成交额没有按「亿」渲染");
    },
  },
  {
    name: "投资页：持仓表由 SSR 直出（不再靠水合后长高）",
    url: "/invest/",
    async run({ page, fail }) {
      // 这一处曾经在线上造成 CLS 0.073：SSR 只画 420 px 骨架屏，水合后整块长到
      // ~1000 px，把下面所有板块推下去。修法不是「量 CLS」而是「别让 SSR 交白卷」：
      // 持仓的代码/名称/份额构建时就有，缺的只是净值列。
      // 断言直接看服务端吐出来的 HTML，跟水合时机无关，因此稳定可复现。
      const response = await page.request.get(new URL("/invest/", page.url()).href);
      if (!response.ok()) return fail(`/invest/ 返回 ${response.status()}`);
      const html = await response.text();
      if (html.includes("h-[420px]")) return fail("SSR 里还有 420px 的骨架屏（水合后会明显长高）");
      const rows = (html.match(/font-mono text-xs">[0-9]{6}<\/td>/g) || []).length;
      if (rows < 8) return fail(`SSR 里的持仓表只有 ${rows} 行（应该直接把持仓都渲染出来）`);
    },
  },
  {
    name: "投资页：跨时段访问不报 hydration 错误",
    url: "/invest/",
    // 把浏览器时钟拨到周六（构建时刻是周五），SSR 与客户端算出的「是否在净值更新时段」
    // 会不一致。修法是时钟文案等挂载后再渲染 —— 这条场景就是锁住它。
    initScript: `{
      // 周五 12:00（北京）= 净值发布窗口内；若构建时刻在窗口外，两者算出的文案不同
      const fixed = new Date("2026-11-20T04:00:00Z").getTime();
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a) { super(...(a.length ? a : [fixed])); }
        static now() { return fixed; }
      }
      window.Date = FakeDate;
    }`,
    async run({ page, fail }) {
      // 结构性断言（与构建时刻无关）：这段文案依赖「现在几点」，SSR 里不能出现，
      // 否则构建时刻和访问时刻跨过窗口边界就会 hydration mismatch（线上 /invest/ 每次访问一条 pageerror）。
      const response = await page.request.get(new URL("/invest/", page.url()).href);
      const html = await response.text();
      if (html.includes("净值发布窗口")) return fail("SSR 里就渲染了时段文案，跨时段访问必然 hydration mismatch");
      await page.waitForTimeout(1200);
      const hint = await page.getByText("净值发布窗口", { exact: false }).first();
      if ((await hint.count()) === 0) return fail("挂载完成后没有显示净值更新时段提示");
    },
  },
  {
    // 第 216 轮：上一轮抓到 React #418 的那条场景只覆盖 /invest/ 一个页面。
    // 但「渲染时读时钟」是一个**类**，不是一处：任何页面只要把 `new Date()` 的结果写进
    // SSR 文本，就会在「访问时刻 ≠ 构建时刻」时炸。这里把时钟拨后 10 天，逐个打开
    // 所有带行情/快照的页面，只要哪一页抛 pageerror（#418）就算失败。
    name: "跨天访问：行情页都不许 hydration 报错",
    url: "/",
    initScript: `{
      // 比构建时刻晚 10 天：快照必然「不是今天」，任何在渲染里算新鲜度的写法都会露馅
      const real = Date.now();
      const fixed = real + 10 * 24 * 3600 * 1000;
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a) { super(...(a.length ? a : [fixed])); }
        static now() { return fixed; }
      }
      window.Date = FakeDate;
    }`,
    async run({ page, fail }) {
      const base = new URL(page.url()).origin;
      for (const route of ["/", "/invest/", "/invest/etf/", "/invest/us-market/"]) {
        await page.goto(new URL(route, base).href, { waitUntil: "networkidle" });
        await page.waitForTimeout(1200);
      }
      // 断言由外层统一做：任何一次导航里的 pageerror / console.error 都会累积成失败。
      // 这里只额外确认页面真的渲染了内容（防止 goto 失败却静默通过）。
      const text = await page.locator("main").first().innerText().catch(() => "");
      if (text.trim().length < 50) return fail("跨天访问时页面没渲染出内容");
    },
  },
  {
    name: "ETF 页：成交表由 SSR 直出（不再先画 360px 骨架屏）",
    url: "/invest/etf/",
    async run({ page, fail }) {
      // 同持仓表：以前 SSR 只画 360px 骨架屏、失败时缩成小卡片，实测 CLS 0.066。
      // 12 只宽基 ETF 的代码/名字构建时就有（etf-registry.json），没理由不渲染。
      const response = await page.request.get(new URL("/invest/etf/", page.url()).href);
      if (!response.ok()) return fail(`/invest/etf/ 返回 ${response.status()}`);
      const html = await response.text();
      if (html.includes("h-[360px]")) return fail("SSR 里还有 360px 骨架屏");
      const codes = new Set(html.match(/>[0-9]{6}</g) || []);
      if (codes.size < 10) return fail(`SSR 里的 ETF 只有 ${codes.size} 只（应该有 12 只）`);
    },
  },
  {
    name: "行情岛：指数接口数据覆盖 SSR 兜底",
    url: "/invest/",
    api: {
      "/api/market/indices": () => ({
        status: 200,
        body: {
          ok: true,
          ts: Date.now(),
          indices: [
            { code: "999999", name: "桩指数", market: "A", price: 12345.67, change: 12.34, change_pct: 0.1 },
          ],
        },
      }),
      "/api/market/sentiment": () => ({ status: 200, body: { ok: true, ts: Date.now() } }),
    },
    async run({ page, fail }) {
      // 组件有 SSR 兜底数据，接口返回后必须**覆盖**掉；用哨兵名才能证明这一点
      await page.waitForTimeout(WAIT + 800);
      const body = await page.locator("body").innerText();
      if (!body.includes("桩指数")) return fail("指数接口返回后没有覆盖 SSR 兜底数据（页面上找不到「桩指数」）");
      if (!/12,345\.67/.test(body)) return fail("指数价格没有按千分位渲染（期望 12,345.67）");
    },
  },
  {
    name: "行情岛：接口 500 时保留 SSR 兜底",
    url: "/invest/",
    api: {
      "/api/market/indices": () => ({ status: 500, body: { ok: false, error: "上游不可用" } }),
      "/api/market/sentiment": () => ({ status: 500, body: { ok: false, error: "上游不可用" } }),
    },
    async run({ page, fail }) {
      await page.waitForTimeout(WAIT + 800);
      const body = await page.locator("body").innerText();
      if (body.includes("桩指数")) return fail("接口失败却出现了桩数据，桩没生效");
      // 不能因为接口挂了就整块消失：兜底数据必须在
      const cards = await page.locator("section [class*='rounded-2xl']").count();
      if (cards < 3) return fail(`接口失败后指数卡片消失（只剩 ${cards} 个）`);
    },
  },
  {
    name: "深色模式切换",
    url: "/",
    async run({ page, fail }) {
      // 用稳定的 id，别绑在 aria-label 文案上（第 143 轮把标签本地化后这条就红了 ——
      // 交互自检不该因为一句翻译而失效）
      const toggle = page.locator("#theme-toggle, button[aria-label*=\"主题\"], button[aria-label*=\"theme\"]").first();
      if ((await toggle.count()) === 0) return fail("找不到主题切换按钮");
      const before = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      await toggle.click();
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      if (before === after) return fail("点击后 <html> 的 dark 类没有变化");
    },
  },
];

async function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    console.error(`✗ ${DIST} 里没有 index.html：先 npm run build`);
    process.exit(2);
  }
  const scenarios = ONLY ? SCENARIOS.filter((s) => s.name.includes(ONLY)) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`✗ --only=${ONLY} 没匹配到场景（可用：${SCENARIOS.map((s) => s.name).join(" / ")}）`);
    process.exit(2);
  }

  const { chromium } = await import("playwright");
  const server = await serveDist(DIST);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
  const failures = [];
  const blockedSummary = new Set();
  let passed = 0;

  try {
    for (const scenario of scenarios) {
      const viewport = scenario.viewport ?? { width: 1280, height: 900 };
      const touch = viewport.width < 640;
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      // 只跑本地构建：第三方域名（giscus.app 等）一律拦住，否则发布门禁就依赖外网了（第 93 轮）
      const hermetic = await makeContextHermetic(context, base);
      const page = await context.newPage();
      const runtimeIssues = [];
      page.on("pageerror", (e) => runtimeIssues.push(`pageerror: ${e.message.slice(0, 160)}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        // 「Failed to load resource」不带 URL；/api/* 在静态服务器上必然 404
        if (/Failed to load resource/.test(text)) return;
        // 第三方（Giscus）自己的报错：CI 出口被限流时它会刷 console.error，
        // 本机复现不出来 —— 不窄化过滤的话，这条噪音会一直随机挡发布。
        if (isThirdPartyConsoleNoise(text, m.location()?.url ?? "")) return;
        runtimeIssues.push(`console: ${text.slice(0, 160)}`);
      });
      page.on("response", (r) => {
        if (r.status() < 400) return;
        const link = r.url();
        if (!link.startsWith(base)) return;
        const rel = link.slice(base.length);
        if (rel.startsWith("/api/") || rel === "/404.html") return;
        runtimeIssues.push(`HTTP ${r.status()}: ${rel.slice(0, 100)}`);
      });

      const problems = [];
      const fail = (message) => {
        problems.push(message);
      };
      // /api/* 是服务器端接口，静态产物里没有。这里用 stub 提供最小契约，
      // 好处是「乐观更新 → POST → 用返回值刷新」整条链路都能在本地验证。
      const apiCalls = [];
      const apiHits = new Map();
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const url = request.url();
        apiCalls.push({ method: request.method(), url });
        const custom = Object.entries(scenario.api ?? {}).find(([prefix]) => url.includes(prefix));
        if (custom) {
          const [prefix, handler] = custom;
          const call = apiHits.get(prefix) ?? 0;
          apiHits.set(prefix, call + 1);
          // handler(call, request)：有的场景要按 HTTP 方法返回不同结果
          const reply = handler(call, request);
          return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
        }
        if (url.includes("/api/feedback")) {
          const body =
            request.method() === "POST"
              ? { likes: 4, dislikes: 1, my_vote: "like" }
              : { likes: 3, dislikes: 1, my_vote: null };
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        }
        return route.fulfill({ status: 204, body: "" });
      });
      const openSearch = async (selector) => {
        const opener = page.locator(selector).first();
        if ((await opener.count()) === 0) return null;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await opener.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(400);
          const input = page.locator("input[type=text]").first();
          if ((await input.count()) > 0) return input;
        }
        return null;
      };
      if (scenario.initScript) await page.addInitScript(scenario.initScript);
      const response = await page.goto(base + scenario.url, { waitUntil: "load", timeout: 60_000 });
      if (response && response.status() >= 400) fail(`页面自身 HTTP ${response.status()}`);
      await page.waitForTimeout(300);
      try {
        await scenario.run({ page, fail, openSearch, apiCalls });
      } catch (error) {
        fail(`动作抛错：${String(error).split("\n")[0].slice(0, 160)}`);
      }
      const all = [...problems, ...runtimeIssues];
      const blockedHosts = hermetic.blocked();
      if (blockedHosts.length > 0) blockedSummary.add(`${scenario.name}: ${blockedHosts.join(",")}`);
      if (all.length) {
        console.log(`✗ ${scenario.name}（${scenario.url}）`);
        for (const problem of [...new Set(all)].slice(0, 5)) console.log(`    ${problem}`);
        failures.push(`${scenario.name}: ${[...new Set(all)][0]}`);
      } else {
        console.log(`✓ ${scenario.name}（${scenario.url}）`);
        passed += 1;
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.error(`\n✗ 交互自检失败：${failures.length}/${scenarios.length} 个场景`);
    process.exit(1);
  }
  if (blockedSummary.size > 0) console.log(`\n· 已拦截第三方请求（只验证本地构建）：${[...blockedSummary].join(" | ")}`);
  console.log(`\n✓ 交互自检通过：${passed}/${scenarios.length} 个场景（搜索、灯箱、点赞、主题、ETF、行情岛、SSR 直出、反馈按需加载）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
