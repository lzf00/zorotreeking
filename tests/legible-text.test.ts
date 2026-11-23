/**
 * 移动端可读性（第 184 轮）。
 *
 * 事故：Lighthouse 的 `font-size` 审计要求"≥12px 的文字占全页 >60%"，而
 * `/hike/` 与 `/hike/travel/ali-grand-loop-lhasa-return-2026/` 都只有 48% —— 
 * 路线卡片的路由串 11.5px、路线表住宿建议 10.6px。SEO 分因此长期是 0.93，
 * 而 Lighthouse 一周才跑一次，等它报警时已经过去七天。
 *
 * 这个测试守三件事：
 *   1. 门禁里有本地口径的可读性检查（10 秒，比 Lighthouse 快）；
 *   2. 检查覆盖 Lighthouse 巡检的每一个 URL（新增 URL 不能绕过本地检查）；
 *   3. 那两处移动断点字号修复还在（别被后续改版静默改回去）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("门禁里有移动端可读性检查，且用的是 Lighthouse 同口径", async () => {
  const pkg = JSON.parse(await read("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["check:legible"], "node scripts/check-legible-text.mjs");
  assert.match(pkg.scripts.gate, /npm run check:text-zoom && npm run check:legible/, "要跟文字缩放检查挨着跑");

  const script = await read("scripts/check-legible-text.mjs");
  assert.match(script, /HARD_FLOOR = 0\.6/, "硬底线必须是 Lighthouse 的 60%");
  assert.match(script, /width: 412/, "口径要和 Lighthouse 移动端一致（412×823）");
  assert.match(script, /fontSize/, "按计算后的字号判定，不是按类名");
  assert.match(script, /::error title=移动端可读文字不足/, "失败要能在 Actions 上看见原因");
});

test("本地检查覆盖 Lighthouse 巡检的每一个 URL", async () => {
  const config = JSON.parse(await read(".lighthouserc.mobile.json")) as {
    ci: { collect: { url: string[] } };
  };
  const script = await read("scripts/check-legible-text.mjs");
  const paths = config.ci.collect.url.map((url) => new URL(url).pathname);
  const missing = paths.filter((path) => !script.includes(`"${path}"`));
  assert.deepEqual(missing, [], `这些页面 Lighthouse 会审、本地却没查：${missing.join(", ")}`);
});

test("部署流程也会量一遍（不能只在本地门禁里）", async () => {
  const deploy = await read(".github/workflows/deploy.yml");
  assert.match(deploy, /name: Mobile legibility/, "部署里要有这一步");
  assert.match(deploy, /npm run check:legible/);
  assert.match(deploy, /smoke\/legible/, "失败要能用 commit status 看见（日志接口 403）");
  // status 只认 GITHUB_TOKEN：第 184 轮上线时这一步漏了 token，结果状态压根没发出去
  const legible = deploy.slice(deploy.indexOf("id: legible"));
  const stepEnv = legible.slice(0, legible.indexOf("run: |"));
  assert.match(stepEnv, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/, "要带 token，否则状态静默丢失");
});

test("路线卡片的移动断点字号修复还在", async () => {
  const hike = await read("src/pages/hike/index.astro");
  assert.match(hike, /@media \(max-width: 640px\)/, "要有移动断点");
  assert.match(hike, /\.route-card__path[\s\S]{0,400}font-size: 12px/, "路由串是那页 26% 的字符，必须 ≥12px");

  const sheet = await read("src/components/travel/AliRouteOverview.astro");
  assert.match(sheet, /ali-route-day__stay-advice[\s\S]{0,900}font-size: 12px/, "住宿建议 10.6px → 12px");
});
