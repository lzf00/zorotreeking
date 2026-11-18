#!/usr/bin/env node
/**
 * 把 LHCI 的逐 URL 中位分数发成 GitHub commit status，一条 URL 一个 context。
 *
 * 为什么需要：审计结果只在 Actions 的日志/产物里，而拿产物要 token。没有 token 的时候
 * 想确认「这轮 /invest/digest/ 到底掉没掉分」只能靠猜——历史上整整一轮都在猜。commit status
 * 是公开可读的（`GET /repos/{owner}/{repo}/commits/{sha}/statuses`），发上去之后任何人都能用
 * 一条 curl 拿到 15 个页面的分数。
 *
 * 用法：
 *   node scripts/lighthouse-statuses.mjs                    # 干跑，打印要发的内容
 *   node scripts/lighthouse-statuses.mjs --json             # 干跑，输出 JSON
 *   node scripts/lighthouse-statuses.mjs --post             # 真发（需要 GITHUB_TOKEN/TARGET_SHA）
 *
 * 环境变量（--post 时）：GITHUB_TOKEN、TARGET_SHA、GITHUB_REPOSITORY（owner/repo）、
 *                        RUN_URL（可选，挂到 target_url 上）
 */
import { readLhrs, summarize } from "./lighthouse-summary.mjs";

/** 阈值和 lighthouse.yml 的 assert 保持一致：性能 < 0.80 记 failure，其余 success */
const PERF_FAIL_BELOW = 0.8;

/** URL 路径 → context 名，`/invest/digest/` → `perf/invest/digest/`，根路径 → `perf/` */
export function contextFor(url) {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 已经是路径
  }
  return `perf${pathname.startsWith("/") ? "" : "/"}${pathname}`;
}

const round = (value, digits = 0) => (Number.isFinite(value) ? (digits ? value.toFixed(digits) : String(Math.round(value))) : "—");

/**
 * 把 summarize() 的行转成 commit status 请求体。
 * description 上限 140 字符，这里最多 ~60，留足余量。
 */
export function buildStatuses(rows, { runUrl } = {}) {
  return rows.map((row) => {
    const perf = Number.isFinite(row.perf) ? row.perf : null;
    const description =
      `${perf === null ? "—" : round(perf * 100)} 分 · LCP ${round(row.lcp / 1000, 2)}s · TBT ${round(row.tbt)}ms` +
      (Number.isFinite(row.cls) ? ` · CLS ${round(row.cls, 3)}` : "");
    return {
      context: contextFor(row.url),
      state: perf !== null && perf >= PERF_FAIL_BELOW ? "success" : "failure",
      description: description.slice(0, 140),
      target_url: runUrl ?? null,
    };
  });
}

/** 同一个 sha 上重复发（重跑审计）不报错，GitHub 会保留最新一条 */
async function postStatuses(statuses, { token, sha, repo }) {
  const url = `https://api.github.com/repos/${repo}/statuses/${sha}`;
  let failed = 0;
  for (const status of statuses) {
    const body = { ...status };
    if (!body.target_url) delete body.target_url;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "zorotreeking-lighthouse-statuses",
      },
      body: JSON.stringify(body),
    }).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }));
    if (!response.ok) {
      failed += 1;
      const detail = await response.text().catch(() => "");
      console.log(`::warning::${status.context} 没发出去（HTTP ${response.status}）${detail.slice(0, 120)}`);
    }
  }
  console.log(`[lh-statuses] 发出 ${statuses.length - failed}/${statuses.length} 条`);
  return failed;
}

async function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--dir");
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : ".lighthouseci";
  const rows = summarize(readLhrs(dir));
  if (rows.length === 0) {
    console.log("[lh-statuses] 没有解析到任何报告，跳过（不发空状态）");
    return;
  }
  const statuses = buildStatuses(rows, { runUrl: process.env.RUN_URL });
  if (args.includes("--json")) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  for (const status of statuses) console.log(`${status.context.padEnd(26)} ${status.state.padEnd(8)} ${status.description}`);
  if (!args.includes("--post")) {
    console.log("\n[lh-statuses] 干跑完成；加 --post 才会真的发到 GitHub");
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  const sha = process.env.TARGET_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !sha || !repo) {
    console.log("::warning::缺少 GITHUB_TOKEN / TARGET_SHA / GITHUB_REPOSITORY，跳过发布");
    return;
  }
  await postStatuses(statuses, { token, sha, repo });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
