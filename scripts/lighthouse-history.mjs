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
    console.log(`\n共 ${audits.length} 轮：${audits.map((audit) => audit.sha).join(" → ")}（左新右旧；↑/↓ 是最新有数据的一轮相对上一轮有数据的列）`);
  }
}
