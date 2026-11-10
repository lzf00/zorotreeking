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
 *
 * 输出：控制台汇总 + a11y-report.json（CI 里作为 artifact 上传）
 */
import fs from "node:fs";
import { chromium } from "playwright";
import axe from "axe-core";

const BASE_URL = process.env.BASE_URL ?? "https://www.zorotreeking.online";

/** 覆盖所有页面模板，而不是只测首页。 */
const PATHS = [
  "/",
  "/en/",
  "/about/",
  "/ai/",
  "/ai/digest/",
  "/ai/digest-2026-06-05/",
  "/invest/",
  "/invest/digest/",
  "/invest/market/",
  "/hike/",
  "/hike/travel/ali-grand-loop-lhasa-return-2026/",
  "/photo/",
  "/photo/baokemeng/",
  "/explore/",
  "/changelog/",
  "/tag/",
];

/** 只看这两个规则：对比度是深色主题最容易坏的地方，heading-order 是浅色主题的常客。 */
const RULES = ["color-contrast", "heading-order"];

const args = process.argv.slice(2);
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

for (const path of PATHS) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const entry = { path, theme, ok: true, violations: [] };
    try {
      await page.goto(BASE_URL + path, { waitUntil: "networkidle", timeout: 60_000 });
      if (theme === "dark") {
        await page.evaluate(() => {
          document.documentElement.classList.add("dark");
          document.documentElement.style.colorScheme = "dark";
        });
      }
      // 入场动画（animate-rise 0.8s）跑完再测：半透明中间态会被当成对比度不足
      await page.waitForTimeout(2500);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async (rules) => {
        const r = await window.axe.run(document, { runOnly: rules });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          count: v.nodes.length,
          nodes: v.nodes.slice(0, 5).map((n) => ({
            target: n.target.join(" "),
            reason: (n.any[0]?.message ?? "").replace(/\s+/g, " ").slice(0, 240),
          })),
        }));
      }, RULES);

      entry.violations = violations;
      if (violations.length) {
        entry.ok = false;
        const isError = violations.some((v) => v.impact === "serious" || v.impact === "critical");
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
    console.log(`${mark} ${theme.padEnd(5)} ${path}${detail ? "  " + detail : ""}`);
    for (const v of entry.violations) {
      for (const n of v.nodes) console.log(`      ${n.target} — ${n.reason}`);
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
