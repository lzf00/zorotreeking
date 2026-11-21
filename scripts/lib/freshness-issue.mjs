/**
 * 内容停更用「Issue」报，而不是 commit status（第 97 轮）。
 *
 * 第 85 轮的做法是把新鲜度写进 `content/freshness` commit status。它确实让沉默的停更
 * 变得可见，但代价是：**每一个提交都挂着一个红叉**。日报停更三天，那三天里所有 commit
 * 的合并状态都是 failure —— 真实的问题（部署失败、烟测红了）被淹在这片红里，
 * 久而久之大家就学会无视红叉了。这叫警报疲劳，比没有信号更糟。
 *
 * Issue 才是内容运维该走的通道：持久、可评论、可关闭、会给维护者发邮件、不挡代码。
 * 而且它天然带状态：停更 → 打开；恢复 → 自动关闭（并留一条"已恢复"的评论）。
 *
 * 这里只放纯逻辑，网络请求在 publish-freshness-issue.mjs 里，方便单测。
 */

export const ISSUE_LABEL = "content/freshness";
export const ISSUE_TITLE = "内容流水线停更（自动维护，请勿手动改名）";

/** @typedef {{ stream: string, newest: string|null, level: "ok"|"warn"|"fail", message?: string }} Row */

/**
 * @param {{ ok: boolean, today: string, rows: Row[] }} summary
 * @returns {{ action: "open"|"close", title: string, body: string }}
 */
export function buildIssue(summary) {
  const stale = summary.rows.filter((row) => row.level === "fail");
  const warn = summary.rows.filter((row) => row.level === "warn");
  const action = summary.ok ? "close" : "open";

  if (action === "close") {
    return {
      action,
      title: ISSUE_TITLE,
      body: [
        `## ✓ 已恢复（${summary.today}）`,
        "",
        "所有内容流水线都在阈值内，这条 issue 由 `freshness-watch` 自动关闭。",
        "",
        ...table(summary.rows),
      ].join("\n"),
    };
  }

  return {
    action,
    title: ISSUE_TITLE,
    body: [
      `## ✗ 有内容流水线停更（检查于 ${summary.today}）`,
      "",
      stale.map((row) => `- **${row.stream}**：最新 ${row.newest ?? "无"}${row.message ? `（${row.message}）` : ""}`).join("\n"),
      "",
      warn.length > 0 ? `另有 ${warn.length} 条接近阈值，注意观察。` : "",
      "",
      ...table(summary.rows),
      "",
      "### 怎么处理",
      "",
      "1. 打开 Actions，看该内容流水线最近一次运行为什么没产出（`startup_failure` 多为权限/工作流语法问题）。",
      "2. 修好之后在 Actions 页面用 **Run workflow** 手动补跑一次（`workflow_dispatch` 已开），或等下一次定时。",
      "   注意 `schedule` 会延迟 5–7 小时，等定时往往要到下午才见结果。",
      "3. 产出恢复后，本 issue 会在下一次 `freshness-watch` 时自动关闭，无需手动操作。",
      "",
      "_本 issue 由 `.github/workflows/freshness-watch.yml` 自动维护；标题被改动会导致重复新建。_",
    ].filter(Boolean).join("\n"),
  };
}

function table(rows) {
  return [
    "| 内容板块 | 最新日期 | 状态 |",
    "|---|---|---|",
    ...rows.map((row) => `| ${row.stream} | ${row.newest ?? "无"} | ${row.level === "ok" ? "正常" : row.level === "warn" ? "接近阈值" : "**停更**"} |`),
  ];
}

/**
 * 已有 issue 里挑出「自动维护」的那条。按标题精确匹配，不看 state（关闭的也要能找回并重开）。
 * @param {Array<{ number: number, title: string, state: string }>} issues
 */
export function pickIssue(issues, title = ISSUE_TITLE) {
  return issues.find((issue) => issue.title === title) ?? null;
}

/**
 * 根据目标动作和 issue 现状，决定要不要发请求。
 * 已经是目标状态就不动 —— 避免每天改一次 body 制造噪音（也避免把 stale 的红色时刻刷新成"刚更新"）。
 * @param {{ action: "open"|"close" }} desired
 * @param {{ state?: string, body?: string } | null} existing
 */
export function decide(desired, existing) {
  if (desired.action === "close" && (!existing || existing.state === "closed")) return { method: "none" };
  if (desired.action === "open" && existing?.state === "open") return { method: "PATCH", reason: "refresh-body" };
  if (desired.action === "open") return { method: existing ? "PATCH" : "POST", reason: existing ? "reopen" : "create" };
  return { method: "PATCH", reason: "close" };
}
