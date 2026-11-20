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
    name: "深色模式切换",
    url: "/",
    async run({ page, fail }) {
      const toggle = page.locator('button[aria-label="toggle theme"]').first();
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
  let passed = 0;

  try {
    for (const scenario of scenarios) {
      const viewport = scenario.viewport ?? { width: 1280, height: 900 };
      const touch = viewport.width < 640;
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      const page = await context.newPage();
      const runtimeIssues = [];
      page.on("pageerror", (e) => runtimeIssues.push(`pageerror: ${e.message.slice(0, 160)}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        // 「Failed to load resource」不带 URL；/api/* 在静态服务器上必然 404
        if (/Failed to load resource/.test(text)) return;
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
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const url = request.url();
        apiCalls.push({ method: request.method(), url });
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
      const response = await page.goto(base + scenario.url, { waitUntil: "load", timeout: 60_000 });
      if (response && response.status() >= 400) fail(`页面自身 HTTP ${response.status()}`);
      await page.waitForTimeout(300);
      try {
        await scenario.run({ page, fail, openSearch, apiCalls });
      } catch (error) {
        fail(`动作抛错：${String(error).split("\n")[0].slice(0, 160)}`);
      }
      const all = [...problems, ...runtimeIssues];
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
  console.log(`\n✓ 交互自检通过：${passed}/${scenarios.length} 个场景（搜索、灯箱、点赞、深浅色）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
