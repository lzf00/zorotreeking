#!/usr/bin/env node
/**
 * 把自检结果发成 commit status —— 一条「没有管理员权限也能读」的通道。
 *
 * 为什么需要：仓库的 Actions 日志接口返回 403（需要管理员权限），`::error::`
 * annotations 在 API 里也只回一条通用的 "Process completed with exit code 1"。
 * 结果是 CI 一红就只能盲猜（第 66/67 轮各踩一次）。commit status 的 description
 * 可以匿名读：`GET /repos/{owner}/{repo}/commits/{sha}/statuses`，所以把
 * 「跑了几页、哪页失败、最差 CLS」写进去，等于给 CI 装了个只读仪表盘。
 *
 * 用法（在 workflow 里）：
 *   node scripts/report-ci-status.mjs --context=smoke/runtime --state=success --log=/tmp/x.log
 *   node scripts/report-ci-status.mjs --context=smoke/runtime --state=failure --log=/tmp/x.log
 *   node scripts/report-ci-status.mjs --dry-run ...（本地只打印 payload）
 *
 * description 上限 140 字符（GitHub 限制），超了会截断。
 */
import { readFileSync } from "node:fs";

const MAX_DESCRIPTION = 140;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    out[match[1]] = match[2] ?? "true";
  }
  return out;
}

/** 从日志里挑一句最能说明问题的描述 */
export function summarize(log, state) {
  const lines = log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (state === "success") {
    // 性能数字最有用，优先它；没有就退到总结行
    const summary =
      lines.find((line) => line.startsWith("核心指标")) ??
      [...lines].reverse().find((line) => line.startsWith("✓ "));
    return summary ?? lines.at(-1) ?? "ok";
  }
  const failed = lines.filter((line) => line.startsWith("✗ "));
  const detail = failed.find((line) => !line.includes("自检失败")) ?? lines.at(-1) ?? "失败";
  return detail.replace(/^✗\s*/, "失败：");
}

export function buildStatus({ context, state, description, sha, repo }) {
  return {
    url: `https://api.github.com/repos/${repo}/statuses/${sha}`,
    payload: { state, context, description: description.slice(0, MAX_DESCRIPTION) },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const state = args.state ?? "success";
  const context = args.context ?? "smoke/unknown";
  const logPath = args.log;
  const log = logPath ? readFileSync(logPath, "utf8") : "";
  const description = args.description ?? summarize(log, state);

  const sha = process.env.GITHUB_SHA ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!args["dry-run"] && (!sha || !repo)) {
    console.error("缺 GITHUB_SHA / GITHUB_REPOSITORY，跳过（不阻塞发布）");
    return;
  }
  if (!sha && !args["dry-run"]) return;

  const { url, payload } = buildStatus({ context, state, description, sha, repo });
  if (args["dry-run"]) {
    console.log(JSON.stringify({ url, payload }, null, 2));
    return;
  }

  // 上报失败绝不能影响发布本身：这是诊断通道，不是门禁。
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ""}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "zorotreeking-ci",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) console.error(`上报 commit status 失败：${response.status}`);
  } catch (error) {
    console.error(`上报 commit status 异常：${error instanceof Error ? error.message : error}`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    // 诊断通道的失败不改变退出码
    process.exit(0);
  });
}
