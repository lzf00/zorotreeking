#!/usr/bin/env node
/**
 * 服务器侧配置体检（nginx / CDN），**从外部探测**，不依赖登录服务器。
 *
 * 为什么要有它：站点性能和安全一半在仓库里（构建产物），另一半在 nginx 配置里，
 * 而后者没有任何门禁看得到。历史上这些坑都是靠人肉 curl 才发现的：
 * - `/index.html` 直接 200（不 301 到正式地址）→ 同一份内容两个 URL，缓存、canonical、
 *   统计三处各算一遍；Shimo 之类的外部工具还会把它当重复内容。
 * - 只开了 gzip 没开 brotli → HTML 28 KB vs 24 KB，1194 个页面全是这个差价
 *   （国内链路带宽最贵，brotli 的静态字典对小 HTML 特别有效）。
 * - `expires 1y` 和 `add_header Cache-Control` 同时作用 → 同一个响应里出现**两行**
 *   `cache-control`，值还不一样（`max-age=31536000` 与 `public, immutable`）。
 *   浏览器多数会合并，但中间层 / 审计工具会各取一行，属于真实隐患。
 * - `/api/market/*` 没有 `cache-control` → 每次进 ETF 页都回源打后端。
 *
 * 用法：
 *   node scripts/check-server.mjs                        # 探线上，只报告
 *   node scripts/check-server.mjs --base=https://…        # 指定站点
 *   node scripts/check-server.mjs --strict               # 有 fail 级问题时退出码 1
 *   node scripts/check-server.mjs --json                 # 输出 JSON（给 CI 汇总用）
 *
 * 判定分级：fail = 明确该修（有标准答案）；warn = 值得改但不阻塞；ok = 符合预期。
 * 每一项都带 `fix`：直接对应 docs/nginx-hardening.md 里的一段配置。
 */

import http from "node:http";
import https from "node:https";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

const DEFAULT_BASE = "https://www.zorotreeking.online";

/** 探测清单：路径 → 期望。所有断言都写在 auditServer 里，这里只放 URL。 */
export const TARGETS = {
  home: "/",
  homeIndex: "/index.html",
  enIndex: "/en/index.html",
  albumIndex: "/photo/index.html",
  soft404: "/definitely-not-a-real-page-9f3a/",
  htmlAsset: null, // 运行时从首页 HTML 里取一个 /_astro/*.js
  photo: "/photos/uploads/hudieren/13408537789923172.thumb480.webp",
  api: "/api/market/indices",
};

const isRedirect = (status) => status >= 300 && status < 400;

/**
 * 把一组探测结果变成「体检结论」。
 * 抽成纯函数是为了能喂假响应做单测（true fetch 在 CI 里不稳定）。
 *
 * @param {{ probe: (path: string, opts?: { acceptEncoding?: string }) => Promise<{ status: number, headers: Headers | Record<string, string>, body?: string }> }} deps
 * @returns {Promise<Array<{ id: string, level: "ok"|"warn"|"fail", title: string, detail: string, fix?: string }>>}
 */
export async function auditServer({ probe }) {
  const findings = [];
  const add = (level, id, title, detail, fix) => findings.push({ id, level, title, detail, ...(fix ? { fix } : {}) });

  const get = async (path, opts) => {
    try {
      return await probe(path, opts);
    } catch (error) {
      add("fail", `unreachable:${path}`, "探测失败", `${path} 请求异常：${error.message}`);
      return null;
    }
  };
  // 响应头用**有序数组**（rawHeaders）表示，而不是 Headers 对象：
  // 同名头的重复次数本身就是检查项（nginx 的 `expires` + `add_header` 会产生两行
  // `cache-control`，而 fetch 的 Headers 会把它们合并成一行，看不见问题）。
  const header = (res, name) => {
    if (!res) return null;
    const hit = res.headerList?.find(([key]) => key.toLowerCase() === name);
    if (!hit) return null;
    const all = res.headerList.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
    return all.join(", ");
  };
  const headerCount = (res, name) => (res?.headerList ?? []).filter(([key]) => key.toLowerCase() === name).length;

  // ── 1. index.html 是否 301 到正式地址 ──────────────────────────────
  const homeIndex = await get(TARGETS.homeIndex);
  if (homeIndex) {
    if (isRedirect(homeIndex.status)) {
      const location = header(homeIndex, "location") ?? "";
      const ok = location.endsWith("/") && !location.includes("index.html");
      add(
        ok ? "ok" : "warn",
        "index-redirect",
        "`/index.html` 重定向到正式地址",
        `${homeIndex.status} → ${location || "(无 Location)"}`,
        ok ? undefined : '改成 `location = /index.html { return 301 /; }`',
      );
    } else {
      add(
        "fail",
        "index-redirect",
        "`/index.html` 没有重定向",
        `返回 ${homeIndex.status}：同一份内容两个 URL（缓存 / canonical / 统计各算一遍）`,
        "加 `location ~ ^/(?<dir>.*/)?index\\.html$ { return 301 /$dir; }`",
      );
    }
  }
  const enIndex = await get(TARGETS.enIndex);
  if (enIndex && !isRedirect(enIndex.status)) {
    add("warn", "index-redirect-nested", "子目录 `/en/index.html` 也没有重定向", `返回 ${enIndex.status}`, "同一条正则规则一起覆盖");
  } else if (enIndex) {
    add("ok", "index-redirect-nested", "子目录 index.html 也做了重定向", `${enIndex.status}`);
  }

  // ── 2. brotli ────────────────────────────────────────────────────
  const home = await get(TARGETS.home, { acceptEncoding: "br, gzip" });
  const homeEncoding = header(home, "content-encoding");
  if (homeEncoding === "br") {
    add("ok", "brotli", "HTML 走 brotli", `content-encoding: br`);
  } else {
    add(
      "warn",
      "brotli",
      "只开了 gzip，没有 brotli",
      `首页对 \`Accept-Encoding: br\` 返回 ${homeEncoding ?? "未压缩"}；HTML 28 KB → 24 KB，1194 页都是这个差价`,
      "装 ngx_brotli，`brotli on; brotli_types text/html text/css application/javascript application/json image/svg+xml;`",
    );
  }
  if (home) {
    const cc = header(home, "cache-control") ?? "";
    const htmlCacheOk = /no-cache|must-revalidate|max-age=(0|[1-9]\d{0,3})\b/.test(cc);
    add(
      htmlCacheOk ? "ok" : "fail",
      "html-cache",
      "HTML 不能被长效缓存",
      `cache-control: ${cc || "(缺失)"}`,
      undefined,
    );
  }

  // ── 3. cache-control 不能重复 ────────────────────────────────────
  const assetPath = await (async () => {
    if (TARGETS.htmlAsset) return TARGETS.htmlAsset;
    const body = home?.body ?? "";
    const match = /\/_astro\/[\w.-]+\.js/.exec(body);
    return match?.[0] ?? null;
  })();
  if (assetPath) {
    const asset = await get(assetPath);
    const count = headerCount(asset, "cache-control");
    const cc = header(asset, "cache-control") ?? "";
    if (count > 1) {
      add(
        "fail",
        "duplicate-cache-control",
        "指纹资源出现两行 `cache-control`",
        `${assetPath} 有 ${count} 行：值不一致会让中间层各取一行`,
        "删掉 `expires 1y;`，只留一条 `add_header Cache-Control \"public, max-age=31536000, immutable\" always;`",
      );
    } else if (/immutable/.test(cc) && /max-age=\d{6,}/.test(cc)) {
      add("ok", "asset-cache", "指纹资源长效缓存", `cache-control: ${cc}`);
    } else {
      add("warn", "asset-cache", "指纹资源缓存不够狠", `cache-control: ${cc || "(缺失)"}`, "`public, max-age=31536000, immutable`");
    }
  }
  const photo = await get(TARGETS.photo);
  if (photo) {
    const count = headerCount(photo, "cache-control");
    const cc = header(photo, "cache-control") ?? "";
    const days = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 0) / 86400;
    if (count > 1) {
      add("fail", "duplicate-cache-control-photo", "图片也出现两行 `cache-control`", `${TARGETS.photo} 有 ${count} 行`, "同上：去掉 `expires`");
    } else if (days >= 7) {
      add("ok", "photo-cache", "图片缓存 ≥ 7 天", `${Math.round(days)} 天`);
    } else {
      add("warn", "photo-cache", "图片缓存偏短", cc || "(缺失)", "`public, max-age=2592000` 起步");
    }
  }

  // ── 4. API 缓存 ──────────────────────────────────────────────────
  const api = await get(TARGETS.api);
  if (api && api.status === 200) {
    const cc = header(api, "cache-control");
    const seconds = Number(/max-age=(\d+)/.exec(cc ?? "")?.[1] ?? 0);
    if (seconds > 0) {
      add("ok", "api-cache", "行情接口有缓存", `${TARGETS.api}: ${cc}`);
    } else {
      add(
        "warn",
        "api-cache",
        "行情接口没有 `cache-control`",
        `${TARGETS.api} 每次访问都回源打后端（开盘时最容易把后端打满）`,
        "`location /api/market/ { add_header Cache-Control \"public, max-age=30, stale-while-revalidate=60\" always; proxy_pass …; }`",
      );
    }
  }

  // ── 5. 软 404 ────────────────────────────────────────────────────
  const miss = await get(TARGETS.soft404);
  if (miss) {
    add(
      miss.status === 404 ? "ok" : "fail",
      "soft-404",
      "不存在的路径返回 404",
      `返回 ${miss.status}`,
      miss.status === 404 ? undefined : "`error_page 404 /404.html;` 且不要 `try_files $uri $uri/ /index.html;` 兜到首页",
    );
  }

  // ── 6. 安全头 ────────────────────────────────────────────────────
  if (home) {
    const checks = [
      ["strict-transport-security", "HSTS"],
      ["x-content-type-options", "nosniff"],
      ["referrer-policy", "Referrer-Policy"],
      ["content-security-policy", "CSP"],
    ];
    const missing = checks.filter(([name]) => !header(home, name)).map(([, label]) => label);
    add(
      missing.length === 0 ? "ok" : "fail",
      "security-headers",
      "安全响应头齐全",
      missing.length ? `缺：${missing.join(" / ")}` : checks.map(([, l]) => l).join(" / "),
      missing.length ? "见 docs/security-headers.md 的 `add_header` 段" : undefined,
    );
  }

  return findings;
}

/**
 * 用 node:https 探测：需要 `rawHeaders` 才能数出「同名头出现了几次」。
 * 重定向不跟随（要看清 301 本身）。
 */
export function httpProbe(base) {
  const origin = new URL(base);
  return async (path, { acceptEncoding } = {}) => {
    const transport = origin.protocol === "http:" ? http : https;
    return await new Promise((resolve, reject) => {
      const request = transport.request(
        new URL(path, base),
        {
          method: "GET",
          headers: { "accept-encoding": acceptEncoding ?? "gzip", "user-agent": "zorotreeking-check-server" },
          timeout: 15000,
        },
        (response) => {
          const headerList = [];
          for (let i = 0; i < response.rawHeaders.length; i += 2) {
            headerList.push([response.rawHeaders[i], response.rawHeaders[i + 1]]);
          }
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            // 首页只取前 256 KB（压缩后）用来找 `/_astro/*.js`，不要整页拉
            if (bytes < 256 * 1024) chunks.push(chunk);
            bytes += chunk.length;
          });
          response.on("end", () => {
            let body;
            if (path === TARGETS.home) {
              const raw = Buffer.concat(chunks);
              // 服务器按 `accept-encoding` 压缩过，不解压就只是一堆二进制，
              // 用正则找 `/_astro/*.js` 会一个都找不到（第一版就是这么静默漏掉的）。
              const encoding = headerList.find(([key]) => key.toLowerCase() === "content-encoding")?.[1] ?? "";
              try {
                body = encoding.includes("br")
                  ? brotliDecompressSync(raw).toString("utf8")
                  : encoding.includes("gzip")
                    ? gunzipSync(raw).toString("utf8")
                    : raw.toString("utf8");
              } catch {
                body = raw.toString("utf8");
              }
            }
            resolve({ status: response.statusCode ?? 0, headerList, body });
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("超时 15 s")));
      request.on("error", reject);
      request.end();
    });
  };
}

const LEVEL_ICON = { ok: "✓", warn: "!", fail: "✗" };

export function formatFindings(findings) {
  const lines = [];
  for (const item of findings) {
    lines.push(`${LEVEL_ICON[item.level] ?? "?"} ${item.title}：${item.detail}`);
    if (item.fix && item.level !== "ok") lines.push(`   → ${item.fix}`);
  }
  const fails = findings.filter((item) => item.level === "fail").length;
  const warns = findings.filter((item) => item.level === "warn").length;
  lines.push("");
  lines.push(fails === 0 ? `服务器侧体检通过（${warns} 条建议）` : `服务器侧体检：${fails} 条必须修、${warns} 条建议`);
  return lines.join("\n");
}

async function main() {
  const arg = (name, fallback) => {
    const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const base = arg("base", DEFAULT_BASE);
  const strict = process.argv.includes("--strict");
  const json = process.argv.includes("--json");

  const findings = await auditServer({ probe: httpProbe(base) });
  if (json) {
    process.stdout.write(`${JSON.stringify({ base, findings }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatFindings(findings)}\n`);
  }
  const fails = findings.filter((item) => item.level === "fail").length;
  if (strict && fails > 0) {
    process.stderr.write(`::error title=服务器侧配置有 ${fails} 处必须修::见 docs/nginx-hardening.md\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
