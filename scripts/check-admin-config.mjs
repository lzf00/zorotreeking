#!/usr/bin/env node
/**
 * 后台配置校验：用无头浏览器真的把 /admin/ 加载一遍，确认 Decap 能解析 config.yml。
 *
 * 为什么需要：config.yml 的 schema 校验只在浏览器里发生。YAML 语法正确 ≠
 * Decap 认——例如 view_filters 多写一个键，页面直接 white-screen 报
 * "Error loading the CMS configuration"（2026-11-09 踩过一次）。
 *
 * 用法：
 *   node scripts/check-admin-config.mjs            # 校验 dist/admin/
 *   ADMIN_CHECK_ROOT=public node scripts/...       # 校验 public/admin/
 *
 * 退出码：0 = 配置正常；1 = 配置有错；浏览器起不来时打警告并返回 0
 * （不因为环境问题卡住部署）。
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.env.ADMIN_CHECK_ROOT || "dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let filePath = path.join(ROOT, urlPath);
      if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function launch() {
  const { chromium } = await import("playwright");
  const attempts = [
    ["bundled chromium", () => chromium.launch()],
    ["system chrome", () => chromium.launch({ channel: "chrome" })],
  ];
  const errors = [];
  for (const [label, fn] of attempts) {
    try {
      const browser = await fn();
      console.log(`· 浏览器: ${label}`);
      return browser;
    } catch (err) {
      errors.push(`${label}: ${String(err).split("\n")[0]}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function main() {
  const server = await serve();
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/admin/`;

  let browser;
  try {
    browser = await launch();
  } catch (err) {
    server.close();
    console.warn(`⚠ 无头浏览器不可用，跳过后台配置校验（部署不受影响）：${err.message}`);
    return 0;
  }

  const page = await browser.newPage();
  let verdict = "timeout";
  let detail = "";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // 等「登录页出现」或「配置报错出现」，最多 25 秒
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const text = (await page.textContent("body").catch(() => "")) || "";
      if (/Error loading the CMS configuration/i.test(text)) {
        verdict = "error";
        const flat = text.replace(/\s+/g, " ");
        // 只截「Config Errors: ... Check your config.yml file.」这一段；
        // body.textContent 里还混着页面内联脚本，直接打出来会淹没真正的报错
        const start = flat.search(/Config Errors:/i);
        if (start >= 0) {
          const rest = flat.slice(start);
          const tail = "Check your config.yml file.";
          const cut = rest.indexOf(tail);
          detail = (cut >= 0 ? rest.slice(0, cut + tail.length) : rest.slice(0, 400)).trim();
        } else {
          detail = flat.slice(0, 400);
        }
        break;
      }
      if (/使用 GitHub 登录|Log in with GitHub|Login/i.test(text)) {
        verdict = "ok";
        break;
      }
      await page.waitForTimeout(500);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (verdict === "ok") {
    console.log("✓ 后台配置校验通过（Decap 成功解析，登录页已渲染）");
    return 0;
  }
  if (verdict === "error") {
    console.error("✗ 后台配置无效，Decap 报错：");
    console.error("  " + detail);
    return 1;
  }
  console.error("✗ 后台页面 25 秒内既没渲染登录页也没报配置错（可能是 CDN 不可达或脚本被拦）");
  return 1;
}

process.exit(await main());
