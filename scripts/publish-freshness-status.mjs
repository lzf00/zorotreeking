/**
 * 把内容新鲜度写成一次 commit status（第 85 轮）。
 *
 * 为什么：AI 日报静默停更三天（第 82 轮定位到「可复用工作流权限升级 → startup_failure」），
 * 期间**站点构建、门禁、巡检全绿**，只有「产出没了」。而 Actions 日志要登录才能看，
 * 维护者长期没有 token，所以那三天里没有任何一个公开信号说「内容断了」。
 *
 * 这个脚本在每次部署时把新鲜度发成 `content/freshness` 状态：
 * 打开任意一次 commit 就能看到「AI 日报 落后 3 天」。它**不阻塞部署**
 * （内容落后不该挡住代码修复的发布），只是让沉默的停更变成可见的红点。
 */
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STREAMS, beijingToday, summarizeFreshness } from "./check-freshness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONTEXT = "content/freshness";

/**
 * 纯逻辑：把新鲜度摘要变成一个 commit status 的描述。
 * description 上限 140 字符（GitHub 限制），state 只有 ok / fail。
 */
export function buildStatus(summary) {
  const stale = summary.rows.filter((row) => row.level === "fail");
  if (!summary.ok) {
    const parts = stale.map((row) => {
      const newest = row.newest ?? "无";
      return row.age == null ? `${row.label} 没有产出` : `${row.label} 落后 ${row.age} 天（最新 ${newest}）`;
    });
    const description = parts.join("；").slice(0, 130);
    return { state: "failure", context: CONTEXT, description: description || "内容停更" };
  }
  // 全部达标：只报最老的一条，避免 description 太长
  const oldest = [...summary.rows].sort((a, b) => (b.age ?? 0) - (a.age ?? 0))[0];
  const description = `最新：${oldest?.label ?? ""} ${oldest?.newest ?? ""}`.trim().slice(0, 130);
  return { state: "success", context: CONTEXT, description };
}

async function readStreamFiles() {
  const filesByStream = {};
  for (const stream of STREAMS) {
    try {
      filesByStream[stream.id] = await readdir(path.join(ROOT, "src/content", stream.dir));
    } catch {
      filesByStream[stream.id] = [];
    }
  }
  return filesByStream;
}

async function main() {
  const today = beijingToday();
  const summary = summarizeFreshness(await readStreamFiles(), { today });
  const status = buildStatus(summary);

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ today, status, rows: summary.rows }, null, 2)}\n`);
  } else {
    console.log(`${status.state === "success" ? "✓" : "✗"} ${status.context}: ${status.description}`);
  }

  const sha = process.env.GITHUB_SHA;
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!sha || !token || !repo) {
    // 本地跑（没 token）只打印，不发请求
    if (!process.argv.includes("--json")) console.log("（本地运行，跳过 status 上报）");
    return;
  }

  execFileSync("curl", [
    "-sS", "-X", "POST",
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Accept: application/vnd.github+json",
    "-d", JSON.stringify(status),
    `https://api.github.com/repos/${repo}/statuses/${sha}`,
  ], { stdio: "ignore" });
  console.log("已上报 status:", status.context, status.state);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
