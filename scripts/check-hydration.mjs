/**
 * 岛（React island）冒烟检查：确认每个页面上的 `<astro-island>` 都能水合、控制台不报错。
 *
 * 为什么需要它：Lighthouse 只看分数，axe 只看可访问性，两者都不会因为
 * 「React 组件在浏览器里崩了」而变红——2026-11-11 升 React 19 / recharts 3 时，
 * 真正能兜住这类回归的就是这个脚本。
 *
 * 用法：
 *   npm run build
 *   node scripts/check-hydration.mjs                  # 自己起静态服务器
 *   node scripts/check-hydration.mjs --cross-time     # 额外用「挪过的时钟」再跑一遍
 *   BASE_URL=http://127.0.0.1:4321 node scripts/check-hydration.mjs   # 打线上/预览
 *
 * `--cross-time` 是为第 69 轮那个 bug 准备的：当时 `/invest/` 每次访问都报
 * hydration mismatch #418，原因是 SSR 在构建时刻、浏览器在访问时刻各算了一次
 * 「现在是否在净值发布窗口」。本地因为构建和访问只差几秒，永远撞不上；把浏览器
 * 时钟挪到别的时段/周末就能稳定复现。这个开关把「跨时段访问」变成常规检查。
 *
 * 退出码 1 表示有页面出现意料之外的报错。
 */

import { chromium } from "playwright";

import { serveDist, chromePath } from "./lib/serve-dist.mjs";

/** 不传 BASE_URL 就自己起一个静态服务器 —— 这样才能直接进 `npm run gate`。 */
const server = process.env.BASE_URL ? null : await serveDist(new URL("../dist", import.meta.url).pathname);
const BASE_URL = (process.env.BASE_URL ?? `http://127.0.0.1:${server.address().port}`).replace(/\/$/, "");
const ARGS = new Set(process.argv.slice(2));
const CROSS_TIME = ARGS.has("--cross-time");
/** 构建时刻一定不在这两个时间里，所以「跨时段」能稳定制造出差异。 */
const SHIFTED_CLOCKS = [
  ["周五 12:00（北京，盘中/净值窗口内）", "2026-11-20T04:00:00Z"],
  ["周六 12:00（北京，休市）", "2026-11-21T04:00:00Z"],
];
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
    return await chromium.launch({ executablePath: chromePath() });
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

  // 跨时段：把浏览器时钟挪走再水合一次。时钟相关的文案若在 SSR 里出现，
  // 这里就会抛出 hydration mismatch（第 69 轮的 #418）。
  const shifted = [];
  if (CROSS_TIME && islands.length > 0) {
    for (const [label, iso] of SHIFTED_CLOCKS) {
      const probe = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const shiftedErrors = [];
      probe.on("pageerror", (e) => shiftedErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
      probe.on("console", (m) => {
        if (m.type() === "error") shiftedErrors.push(m.text().slice(0, 160));
      });
      await probe.addInitScript(`{
        const fixed = new Date(${JSON.stringify(iso)}).getTime();
        const RealDate = Date;
        class FakeDate extends RealDate {
          constructor(...a) { super(...(a.length ? a : [fixed])); }
          static now() { return fixed; }
        }
        window.Date = FakeDate;
      }`);
      try {
        await probe.goto(BASE_URL + path, { waitUntil: "networkidle", timeout: 60_000 });
      } catch (e) {
        shiftedErrors.push(`goto: ${String(e).slice(0, 120)}`);
      }
      await probe.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
      await probe.waitForTimeout(1500);
      for (const error of shiftedErrors.filter((e) => !EXPECTED.test(e) && !/\b404\b/.test(e))) {
        shifted.push(`${label}：${error}`);
      }
      await probe.close();
    }
  }

  const all = [...real, ...shifted];
  if (all.length > 0) failures++;
  const mark = all.length > 0 ? "✗" : "✓";
  console.log(`${mark} ${path.padEnd(32)} islands=${islands.length}  ${all.slice(0, 2).join(" | ")}`);
  await page.close();
}

await browser.close();
server?.close();

if (failures > 0) {
  console.error(`\n${failures} 个页面有水合/控制台异常（共 ${islandsSeen} 个岛）`);
  process.exit(1);
}
console.log(`\n全部干净：${PATHS.length} 个页面、${islandsSeen} 个岛`);
