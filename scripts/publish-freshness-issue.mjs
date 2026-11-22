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

/**
 * 一次 API 调用 → { status, body }。
 *
 * 第 178 轮：原来是「curl -sS 然后 JSON.parse」。HTTP 4xx/5xx 时 curl 仍然退出 0，
 * 于是错误响应被当成正常结果继续用（`created.number` 变成 undefined）；而一旦响应不是
 * JSON（网关返回 HTML、连接被掐），`JSON.parse` 直接抛异常 —— 整个 job 变红，
 * 排在后面的「内容到底停没停更」那一步根本没跑。**报警器自己坏了，把警报也一起吞了。**
 * 现在显式读状态码，4xx/5xx 走各自的处理，不再有"猜"的空间。
 */
function api(method, url, body, token) {
  const args = ["-sS", "-w", "\n%{http_code}", "-X", method, "-H", `Authorization: Bearer ${token}`, "-H", "Accept: application/vnd.github+json"];
  if (body) args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  args.push(url);
  const out = execFileSync("curl", args, { encoding: "utf8" });
  return splitCurlOutput(out);
}

/** `-w "\n%{http_code}"` 的产物 → { status, body }。响应体里可能有换行，所以从**最后**一个换行切。 */
export function splitCurlOutput(out) {
  const cut = out.lastIndexOf("\n");
  const raw = cut === -1 ? "" : out.slice(0, cut);
  const status = Number((cut === -1 ? out : out.slice(cut + 1)).trim());
  let parsed = null;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    parsed = { message: raw.trim().slice(0, 200) };
  }
  return { status, body: parsed };
}

/** 仓库里没有这个 label 时，POST /issues 会 422 且 errors[].code === "missing_field"? 不是 —— 是 "invalid"。
 * 这里只判断「是不是 label 引起的 422」，与具体文案解耦。 */
export function isMissingLabel(response) {
  if (response?.status !== 422) return false;
  const text = JSON.stringify(response.body ?? "");
  return /label/i.test(text);
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

  const listed = await api("GET", `https://api.github.com/repos/${repo}/issues?state=all&labels=${encodeURIComponent(ISSUE_LABEL)}&per_page=20`, null, token).catch(() => null);
  if (listed && listed.status !== 200) {
    console.log(`::warning::读取 issue 列表失败（HTTP ${listed.status}）：${listed.body?.message ?? ""}`);
    return;
  }
  const existing = pickIssue(Array.isArray(listed?.body) ? listed.body : [], ISSUE_TITLE);
  const plan = decide(desired, existing);
  console.log(`已有 issue：${existing ? `#${existing.number}（${existing.state}）` : "无"} → ${plan.method}${plan.reason ? ` (${plan.reason})` : ""}`);

  if (plan.method === "none") return;

  const payload = { title: desired.title, body: desired.body, labels: [ISSUE_LABEL] };
  if (plan.method === "POST") {
    let created = await api("POST", `https://api.github.com/repos/${repo}/issues`, payload, token);
    // 仓库里从没建过 `content/freshness` 这个 label 时，GitHub 会直接 422 拒掉，
    // 而不是"自动带上一个新 label"。第 178 轮实测：仓库里 issue 数为 0、label 也没有，
    // 于是第一次真要报警时根本发不出去 —— 报警器只在最需要的时刻坏了。
    if (isMissingLabel(created)) {
      console.log(`label「${ISSUE_LABEL}」不存在，先创建它`);
      const label = await api("POST", `https://api.github.com/repos/${repo}/labels`, {
        name: ISSUE_LABEL,
        color: "d93f0b",
        description: "内容流水线停更（freshness-watch 自动维护）",
      }, token);
      if (label.status >= 300) {
        console.log(`::warning::创建 label 失败（HTTP ${label.status}）：${label.body?.message ?? ""}，改为不带 label 建 issue`);
        const { labels: _labels, ...noLabel } = payload;
        created = await api("POST", `https://api.github.com/repos/${repo}/issues`, noLabel, token);
      } else {
        created = await api("POST", `https://api.github.com/repos/${repo}/issues`, payload, token);
      }
    }
    if (created.status >= 300) {
      console.log(`::warning::新建 issue 失败（HTTP ${created.status}）：${created.body?.message ?? ""}`);
      return;
    }
    console.log(`已新建 issue #${created.body?.number}`);
    return;
  }
  const patched = await api(
    "PATCH",
    `https://api.github.com/repos/${repo}/issues/${existing.number}`,
    desired.action === "close"
      ? { state: "closed", state_reason: "completed" }
      : { ...payload, state: "open" },
    token,
  );
  if (patched.status >= 300) {
    console.log(`::warning::更新 issue #${existing.number} 失败（HTTP ${patched.status}）：${patched.body?.message ?? ""}`);
    return;
  }
  console.log(`已${desired.action === "close" ? "关闭" : "更新/重开"} issue #${existing.number}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // 「报告」永远不该把 job 弄红：红了只会遮住下一步真正的内容判定。
  try {
    await main();
  } catch (error) {
    console.log(`::warning::同步 issue 时出错，本轮跳过（内容判定照常进行）：${error instanceof Error ? error.message : error}`);
  }
}
