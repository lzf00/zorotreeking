/**
 * 校验「用户真正收到的 HTML」是不是本次发布的产物（第 102 轮）。
 *
 * 为什么需要：`deploy-meta.json` 只证明**那个文件**换新了。HTML 和它不是一个响应：
 * nginx 只要把 `/index.html` 多缓存一会儿（或者中间有 CDN），用户拿到的就还是上一版，
 * 而 deploy-meta.json 已经绿了 —— 发布链路会说"成功"，人看到的却是旧页面。
 * 这种事不报错，只会让人觉得"我改了怎么没生效"。
 *
 * 做法：构建时把提交号写进 `<meta name="build">`，部署验收时用**禁用缓存**的请求打首页，
 * 断言这个 meta 等于本次发布的 sha。
 *
 * 用法：
 *   node scripts/check-build-stamp.mjs --url=https://example.com/ --expect=<sha>
 *   node scripts/check-build-stamp.mjs --file=dist/index.html --expect=dev
 */
import { readFile } from "node:fs/promises";

/** 从 HTML 里抽出构建标记。抽不到就是 null（老版本产物没有这个 meta）。 */
export function extractBuildSha(html) {
  const match = /<meta\s+name="build"\s+content="([^"]*)"/i.exec(html);
  return match ? match[1] : null;
}

/** 本地构建没带 PUBLIC_BUILD_SHA 时用的占位值。 */
export const LOCAL_STAMP = "local";

export async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      // 关键：绕开一切缓存，取的就是边缘/服务器这一刻会发给用户的那份
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "zorotreeking-build-stamp/1.0",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const expect = valueOf("expect") ?? process.env.GITHUB_SHA;
  const url = valueOf("url");
  const file = valueOf("file");

  if (!expect) {
    console.error("✗ 缺少 --expect=<sha>（或 GITHUB_SHA）");
    process.exit(2);
  }
  const html = file ? await readFile(file, "utf8") : await fetchHtml(url);
  const actual = extractBuildSha(html);
  if (actual === null) {
    console.error(`✗ 页面里没有 <meta name="build">：老产物或构建时没注入 PUBLIC_BUILD_SHA`);
    process.exit(1);
  }
  if (actual !== expect) {
    console.error(`✗ 收到的是旧版本 HTML：meta build=${actual}，期望 ${expect}`);
    process.exit(1);
  }
  console.log(`✓ HTML 构建标记匹配：${actual}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
