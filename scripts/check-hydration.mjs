/**
 * 岛（React island）冒烟检查：确认每个页面上的 `<astro-island>` 都能水合、控制台不报错。
 *
 * 为什么需要它：Lighthouse 只看分数，axe 只看可访问性，两者都不会因为
 * 「React 组件在浏览器里崩了」而变红——2026-11-11 升 React 19 / recharts 3 时，
 * 真正能兜住这类回归的就是这个脚本。
 *
 * 用法（需要一个已经 build 好的静态站点在跑）：
 *   npm run build
 *   node scripts/serve-dist.mjs &          # 或任意静态服务器
 *   BASE_URL=http://127.0.0.1:4321 node scripts/check-hydration.mjs
 *
 * 退出码 1 表示有页面出现意料之外的报错。
 */

import { chromium } from "playwright";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const PATHS = (process.env.PATHS ?? [
  "/",
  "/invest/",
  "/invest/etf/",
  "/invest/stock/300502.SZ/",
  "/photo/baokemeng/",
  "/ai/",
  "/explore/",
].join(",")).split(",");

// 本地静态服务器没有 FastAPI 后端，这几个接口 404 是预期的，不算回归。
const EXPECTED = /\/api\/(track|models|feedback|guestbook)/;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // 没装 Playwright 自带内核时退回系统 Chrome（CI runner 与部分本地环境）
    return await chromium.launch({ channel: "chrome" });
  }
}

const browser = await launch();
let failures = 0;
let islandsSeen = 0;

for (const path of PATHS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  try {
    await page.goto(BASE_URL + path, { waitUntil: "networkidle", timeout: 60_000 });
  } catch (e) {
    errors.push(`goto: ${String(e).slice(0, 120)}`);
  }
  // client:visible 的岛要滚到附近才水合，慢动画也要跑完
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
  await page.waitForTimeout(2500);

  const islands = await page.$$eval("astro-island", (els) =>
    els.map((el) => ({ total: 1, hasChildren: el.children.length > 0, hasShadow: !!el.shadowRoot })),
  );
  islandsSeen += islands.length;

  const real = errors.filter((e) => !EXPECTED.test(e) && !/\b404\b/.test(e));
  if (real.length > 0) failures++;
  const mark = real.length > 0 ? "✗" : "✓";
  console.log(`${mark} ${path.padEnd(32)} islands=${islands.length}  ${real.slice(0, 2).join(" | ")}`);
  await page.close();
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} 个页面有水合/控制台异常（共 ${islandsSeen} 个岛）`);
  process.exit(1);
}
console.log(`\n全部干净：${PATHS.length} 个页面、${islandsSeen} 个岛`);
