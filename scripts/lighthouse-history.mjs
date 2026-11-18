#!/usr/bin/env node
/**
 * 读取最近几轮 Lighthouse 审计的逐 URL 分数，拼成一张趋势表。
 *
 * 数据来源是公开的 commit status API（`GET /commits/<sha>/statuses`，每条 `lhci/url/<path>`
 * 的 description 就是 "Performance: X, Accessibility: Y, ..."）。不需要 token，也不需要
 * Actions 日志或 artifact——所以在这台机器上随时能查「这段时间到底慢在哪」。
 *
 * 用法：
 *   node scripts/lighthouse-history.mjs            # 最近 6 轮
 *   node scripts/lighthouse-history.mjs --rounds 3
 *   node scripts/lighthouse-history.mjs --json     # 机器可读（给后续画图/存档用）
 *
 * 注意：未认证 API 每小时 60 次，默认只取 6 轮（≈7 次请求）。
 */
const REPO = "lzf00/zorotreeking";
const API = `https://api.github.com/repos/${REPO}`;
const METRIC_KEYS = ["Performance", "Accessibility", "Best Practices", "SEO"];

export function parseScores(description) {
  const scores = {};
  for (const [, key, value] of String(description).matchAll(/(Performance|Accessibility|Best Practices|SEO):\s*(\d+)/g)) {
    scores[key] = Number(value);
  }
  return scores;
}

/**
 * 从 `perf/audited` 状态的描述里取「这一轮实际审的是哪一版」。
 * 描述形如 `audited d079cdb (run 44362520358)`。取不到就返回 null。
 */
export function auditedFromDescription(description) {
  const match = String(description ?? "").match(/audited\s+([0-9a-f]{7,40})/i);
  return match ? match[1].toLowerCase() : null;
}

/** 把 URL 从 status context（`lhci/url/invest/`）还原成 `/invest/` */
export function pathFromContext(context) {
  const rest = context.slice("lhci/url/".length);
  return rest ? `/${rest}` : "/";
}

/**
 * 表格：列是「从新到旧」的审计轮次，行是 URL。
 * 最新一轮后面跟 ↑/↓ 表示相对上一轮的变化，方便判断是不是真在退。
 */
export function buildTable(audits) {
  const paths = [...new Set(audits.flatMap((audit) => Object.keys(audit.urls)))].sort();
  const header = [
    "URL",
    ...audits.map((audit) => `${audit.sha} ${audit.date.slice(5, 16).replace("T", " ")}`),
  ];
  const rows = paths.map((path) => {
    const cells = audits.map((audit) => {
      const entry = audit.urls[path];
      if (!entry) return "—";
      if (entry.state !== "success") return `✗${entry.state[0]}`;
      if (entry.Performance !== undefined) return String(entry.Performance);
      // LHCI 在「断言只有警告」时描述里不带分数，写成 "Passed with 2 warning(s)"
      return entry.description?.includes("warning") ? "⚠" : "?";
    });
    // 有些轮次只发出了部分 URL 的 status（审计中途被取消），所以要找「左边最近一个有数字的列」
    const numbers = cells.map((cell, index) => [index, Number(cell)]).filter(([, value]) => Number.isFinite(value));
    const delta = numbers.length >= 2 ? numbers[0][1] - numbers[1][1] : 0;
    const arrow = delta === 0 ? "" : delta > 0 ? ` ↑${delta}` : ` ↓${Math.abs(delta)}`;
    return [`\`${path}\``, `${cells[0]}${arrow}`, ...cells.slice(1)];
  });
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [
    line(header),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}


/** 中位数（偶数取中间两个的平均），空数组返回 null。 */
export function median(values) {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 单轮内「相对本轮中位数」的偏差。
 *
 * 为什么需要它：CI 跑者的快慢会整轮一起漂。实测 c3f5f6c 这一轮 15 个 URL 全部比上一轮
 * 高 2–6 分（首页 94→98、`/hike/` 92→98），而这段时间没有改任何代码路径——所以跨轮的
 * 绝对分数差值不能当回归判据。用「本轮中位数」当基准，跑者快慢被减掉，剩下的才是页面
 * 自己的结构性差距。
 */
export function buildRelativeTable(audits) {
  const latest = audits.find((audit) => Object.keys(audit.urls).length > 0);
  if (!latest) return "（没有可用的分数）";
  const entries = Object.entries(latest.urls)
    .filter(([, entry]) => entry.state === "success" && Number.isFinite(entry.Performance))
    .map(([path, entry]) => ({ path, score: entry.Performance }))
    .sort((a, b) => a.score - b.score);
  const baseline = median(entries.map((entry) => entry.score));
  const header = ["URL", "性能", "本轮中位数", "偏差"];
  const rows = entries.map((entry) => {
    const gap = entry.score - baseline;
    return [
      `\`${entry.path}\``,
      String(entry.score),
      String(baseline),
      gap === 0 ? "0" : gap > 0 ? `+${gap}` : String(gap),
    ];
  });
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [
    line(header),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

/**
 * 轮次表：一轮一行，标出「提交 / 审计声明的版本 / 两者是否一致」。
 * 分数表（buildTable）看趋势，这张表看「分数到底属于谁」。
 */
export function buildRoundTable(audits) {
  const header = ["提交", "时间 (UTC)", "审计声明的版本", "一致?", "主题"];
  const rows = audits.map((audit) => {
    const audited = audit.auditedSha ? audit.auditedSha.slice(0, 7) : "（无状态）";
    const agree = !audit.auditedSha ? "—" : audit.auditedSha.startsWith(audit.sha) ? "✓" : "✗ 错位";
    return [
      `\`${audit.sha}\``,
      audit.date.slice(0, 16).replace("T", " "),
      audit.auditedSha ? `\`${audited}\`` : audited,
      agree,
      (audit.subject || "").replaceAll("|", "\\|"),
    ];
  });
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [
    line(header),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "zorotreeking-perf-history" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 120)}`);
  }
  return res.json();
}

async function collectAudits(rounds, maxProbes = 12) {
  const commits = await fetchJson(`${API}/commits?per_page=30`);
  const audits = [];
  let probes = 0;
  for (const commit of commits) {
    if (audits.length >= rounds || probes >= maxProbes) break;
    probes += 1;
    const statuses = await fetchJson(`${API}/commits/${commit.sha}/statuses?per_page=100`);
    const lhci = statuses.filter((status) => status.context.startsWith("lhci/url/"));
    // 审计声明的版本。和提交本身不一致，说明这轮分数不是这个提交的（历史踩过两次：
    // workflow_run 的 GITHUB_SHA 是排队时的默认分支头，队列里被新提交顶掉就会错位）。
    const auditedStatus = statuses.find((status) => status.context === "perf/audited");
    if (lhci.length === 0) continue;
    const urls = {};
    for (const status of lhci) {
      urls[pathFromContext(status.context)] = {
        state: status.state,
        description: status.description || "",
        ...parseScores(status.description || ""),
      };
    }
    audits.push({
      sha: commit.sha.slice(0, 7),
      date: commit.commit.committer.date,
      subject: commit.commit.message.split("\n")[0].slice(0, 60),
      auditedSha: auditedStatus ? auditedFromDescription(auditedStatus.description) : null,
      urls,
    });
  }
  return audits;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const roundsArg = args.indexOf("--rounds");
  const rounds = roundsArg >= 0 ? Number(args[roundsArg + 1]) || 6 : 6;
  // 未认证 API 每小时 60 次：每次探测一个提交，最多探 12 个，避免一次跑完额度
  const audits = await collectAudits(rounds, 12);
  if (audits.length === 0) {
    console.error("最近 30 个提交里没有找到 Lighthouse 审计结果（可能都没跑成）");
    process.exit(1);
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify({ audits }, null, 2));
  } else {
    console.log(buildTable(audits));
    console.log(`\n${buildRoundTable(audits)}`);
    console.log(`\n${buildRelativeTable(audits)}`);
    console.log("\n偏差 = 该 URL 性能分 − 本轮 15 个 URL 的性能中位数。跨轮的绝对分差不可比：跑者一换，整轮会一起漂 2–6 分。");
    console.log(`\n共 ${audits.length} 轮：${audits.map((audit) => audit.sha).join(" → ")}（左新右旧；↑/↓ 是最新有数据的一轮相对上一轮有数据的列）`);
  }
}
