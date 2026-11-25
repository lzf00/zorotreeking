#!/usr/bin/env node
/**
 * 检查 giscus（GitHub Discussions 评论）到底连没连上仓库（第 208 轮）。
 *
 * 线上实测（2026-11-26）：/guestbook/ 页面里的评论 iframe 一直在请求
 *   https://giscus.app/api/discussions?repo=lzf00%2Fzorotreeking&term=guestbook&category=General...
 * 并稳定返回 **404** —— giscus 无法读取该仓库的 Discussions。
 * 常见原因只有一个：**giscus GitHub App 没有装在这个仓库上**（或装着但没给 Discussions 权限）。
 * 页面自己发现不了这件事：iframe 是跨域的，CORS 只允许 giscus.app 自己读，父页面拿不到状态。
 *
 * 所以把这件事做成构建期/CI 的探测：拿真实参数打一次 giscus API，把结论翻译成人话。
 *
 * 用法：
 *   node scripts/check-giscus.mjs            # 读环境变量；没配置就跳过（不是失败）
 *   node scripts/check-giscus.mjs --json
 *
 * 环境变量：PUBLIC_GISCUS_REPO / PUBLIC_GISCUS_CATEGORY / PUBLIC_GISCUS_TERM（默认 guestbook）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GISCUS_API = "https://giscus.app/api/discussions";

/** 拼出 giscus 客户端会打的 URL（参数与 client.js 一致） */
export function discussionsUrl({ repo, category = "General", term, strict = false }) {
  const q = new URLSearchParams({
    repo,
    term,
    category,
    number: "0",
    strict: String(strict),
    first: "15",
  });
  return `${GISCUS_API}?${q.toString()}`;
}

/**
 * 纯函数：把 HTTP 状态翻译成结论。
 * 200 → 通了；404 → App 没连仓库（最常见）；其它 → 不确定，别下结论。
 */
export function judgeGiscus(status) {
  if (status === 200) return { level: "ok", message: "giscus 能读到仓库的 Discussions（评论可用）" };
  if (status === 404) {
    return {
      level: "broken",
      message:
        "giscus 连不上这个仓库的 Discussions（404）—— 通常是 giscus GitHub App 没装到仓库上：" +
        "打开 https://github.com/apps/giscus 安装到该仓库，确认 Discussions 已启用、分类存在，" +
        "再到 https://giscus.app 用同一仓库重新生成 data-repo-id / data-category-id 写进 secrets。",
    };
  }
  return { level: "unknown", message: `giscus API 返回 ${status}，无法判断（可能只是它自己在抖动）` };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const repo = process.env.PUBLIC_GISCUS_REPO ?? "";
  const category = process.env.PUBLIC_GISCUS_CATEGORY ?? "General";
  const term = process.env.PUBLIC_GISCUS_TERM ?? "guestbook";

  if (!repo) {
    const out = { level: "skipped", message: "没有配置 PUBLIC_GISCUS_REPO —— 本地/未启用评论时跳过（不是失败）" };
    process.stdout.write(json ? `${JSON.stringify(out, null, 2)}\n` : `${out.message}\n`);
    process.exit(0);
  }

  const url = discussionsUrl({ repo, category, term });
  let status = 0;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    status = res.status;
  } catch (e) {
    const out = { level: "unknown", message: `giscus API 请求失败：${String(e).slice(0, 120)}` };
    process.stdout.write(json ? `${JSON.stringify(out, null, 2)}\n` : `${out.message}\n`);
    process.exit(0);
  }
  const verdict = { ...judgeGiscus(status), status, url };
  if (json) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  } else {
    console.log(`${verdict.level === "ok" ? "✓" : verdict.level === "broken" ? "✗" : "!"} ${verdict.message}`);
  }
  if (verdict.level === "broken") console.log("::warning title=giscus 评论不可用::GitHub 留言区连不上仓库，详见 step summary");
  process.exit(0); // 永远不拦发布：这是配置状态，不是代码正确性
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
