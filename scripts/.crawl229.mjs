import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { chromePath, serveDist } from "./lib/serve-dist.mjs";

const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
// 收集页面：sitemap 全量，按类型分层抽样 + 所有含岛的页面
const sitemap = readFileSync("dist/sitemap.xml", "utf8");
const urls = [...sitemap.matchAll(/<loc>https:\/\/www\.zorotreeking\.online([^<]*)<\/loc>/g)].map((m) => m[1]);
const islandPages = [];
for (const p of await readdir("dist", { recursive: true })) {
  if (!p.endsWith("index.html")) continue;
  const html = readFileSync(path.join("dist", p), "utf8");
  if (html.includes("<astro-island")) islandPages.push("/" + p.replace(/index\.html$/, ""));
}
const byKind = new Map();
const pick = [];
for (const u of urls) {
  const kind = u.split("/")[1] || "home";
  const n = byKind.get(kind) ?? 0;
  if (n < 6) { byKind.set(kind, n + 1); pick.push(u); }
}
const sample = [...new Set([...pick, ...islandPages, "/", "/photo/baokemeng/", "/search/", "/guestbook/"])];
console.log(`抽查 ${sample.length} 个页面（sitemap ${urls.length} 条，含岛的页面 ${islandPages.length} 个）`);

const browser = await chromium.launch({ executablePath: chromePath() });
const problems = [];
for (const route of sample) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [], warns = [], bad = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
  page.on("console", (m) => {
    const text = m.text();
    // /api/** 在本地静态服务器上必然 404（线上有后端），这类"资源加载失败"由 response 监听统一复核，
    // 这里只关心真正的脚本错误与警告，避免 63 个页面全被同一条噪声刷屏。
    if (/Failed to load resource|net::ERR/.test(text)) return;
    if (m.type() === "error") errs.push("console: " + text.slice(0, 120));
    if (m.type() === "warning") warns.push(text.slice(0, 100));
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) return; // 本地没有后端，属已知噪声
    if (r.status() >= 400) bad.push(`${r.status()} ${u.pathname}`);
  });
  try {
    const resp = await page.goto(base + route, { waitUntil: "networkidle", timeout: 45000 });
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let y = 0; y <= document.body.scrollHeight; y += 900) { window.scrollTo(0, y); await sleep(30); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(700);
    const status = resp?.status();
    if (status !== 200) problems.push({ route, kind: "HTTP " + status });
    if (errs.length) problems.push({ route, kind: "报错", detail: errs.slice(0, 2) });
    if (bad.length) problems.push({ route, kind: "失败请求", detail: bad.slice(0, 3) });
    const nuxt = warns.filter((w) => /hydration|mismatch/i.test(w));
    if (nuxt.length) problems.push({ route, kind: "水合警告", detail: nuxt.slice(0, 2) });
  } catch (e) {
    problems.push({ route, kind: "超时/崩溃", detail: String(e).slice(0, 120) });
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log(problems.length ? `发现 ${problems.length} 处问题：` : "全部干净");
for (const p of problems.slice(0, 25)) console.log(`  ${p.route}  ${p.kind}  ${JSON.stringify(p.detail ?? "")}`);
