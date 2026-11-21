/**
 * 把内容新鲜度同步成一条 GitHub Issue（第 97 轮）。
 *
 * 取代第 85 轮的 `content/freshness` commit status —— 那条状态让每个提交都挂红叉，
 * 导致警报疲劳（详见 scripts/lib/freshness-issue.mjs 的说明）。
 *
 * 用法：
 *   node scripts/publish-freshness-issue.mjs            # 有 token 就真的建/关 issue
 *   node scripts/publish-freshness-issue.mjs --dry-run   # 只打印将要做什么
 *   node scripts/publish-freshness-issue.mjs --json      # 机器可读
 *
 * 退出码恒为 0：这是「报告」不是「判定」。要不要红由 workflow 里的 check-freshness 决定，
 * 免得报告失败本身被误当成内容停更。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeFreshness } from "./check-freshness.mjs";
import { ISSUE_LABEL, ISSUE_TITLE, buildIssue, decide, pickIssue } from "./lib/freshness-issue.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function api(method, url, body, token) {
  const args = ["-sS", "-X", method, "-H", `Authorization: Bearer ${token}`, "-H", "Accept: application/vnd.github+json"];
  if (body) args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  args.push(url);
  const out = execFileSync("curl", args, { encoding: "utf8" });
  return out ? JSON.parse(out) : null;
}

export async function main(argv = process.argv.slice(2)) {
  const summary = await summarizeFreshness({ root: ROOT });
  const desired = buildIssue(summary);
  const dryRun = argv.includes("--dry-run");

  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ summary, desired }, null, 2)}\n`);
    return;
  }
  console.log(`${desired.action === "close" ? "✓" : "✗"} 内容新鲜度：${summary.ok ? "全部在阈值内" : "存在停更"} → issue 应${desired.action === "close" ? "关闭" : "打开"}`);

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (dryRun || !token || !repo) {
    console.log("（没有 token 或 --dry-run，只打印，不改 issue）");
    return;
  }

  const open = await api("GET", `https://api.github.com/repos/${repo}/issues?state=all&labels=${encodeURIComponent(ISSUE_LABEL)}&per_page=20`, null, token).catch(() => []);
  const existing = pickIssue(Array.isArray(open) ? open : [], ISSUE_TITLE);
  const plan = decide(desired, existing);
  console.log(`已有 issue：${existing ? `#${existing.number}（${existing.state}）` : "无"} → ${plan.method}${plan.reason ? ` (${plan.reason})` : ""}`);

  if (plan.method === "none") return;

  const payload = { title: desired.title, body: desired.body, labels: [ISSUE_LABEL] };
  if (plan.method === "POST") {
    const created = await api("POST", `https://api.github.com/repos/${repo}/issues`, payload, token);
    console.log(`已新建 issue #${created.number}`);
    return;
  }
  if (desired.action === "close") {
    await api("PATCH", `https://api.github.com/repos/${repo}/issues/${existing.number}`, { state: "closed", state_reason: "completed" }, token);
    console.log(`已关闭 issue #${existing.number}`);
    return;
  }
  await api("PATCH", `https://api.github.com/repos/${repo}/issues/${existing.number}`, { ...payload, state: "open" }, token);
  console.log(`已更新/重开 issue #${existing.number}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
