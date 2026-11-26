#!/usr/bin/env node
/**
 * 「内容进了仓库，但站点没上线」的探针（第 213 轮）。
 *
 * 事故：2026-11-24 与 11-25，`daily-digest` 连续四次挂在被调用的 deploy 的
 * `Unit and guard tests` 上。抓取 job 是**成功**的：日报内容已经在 main 里，
 * 只是部署被测试拦下 —— 于是线上两天没更新，而**所有看门狗都是绿的**：
 *
 *   · `check-freshness.mjs` 读的是 `src/content/` 的文件名 → 仓库里有今天的稿子，绿；
 *   · 部署只在真正跑完时才写 `content/freshness` status → 失败的 run 什么都没写，没人红；
 *   · 站点本身很健康（首页 200、API 200），可用性巡检当然也绿。
 *
 * 换句话说：**「今天有没有写」和「今天有没有发」是两件事**，此前只测了前者。
 *
 * 这个脚本补上后者：把仓库里最新的内容日期，和线上 `deploy-meta.json` 的构建时间、
 * 以及线上那篇内容的实际状态（2xx / 404）放在一起判。
 *
 * 用法：
 *   node scripts/check-deploy-freshness.mjs                      # 打线上
 *   node scripts/check-deploy-freshness.mjs --base=https://…     # 指定站点
 *   node scripts/check-deploy-freshness.mjs --max-lag-hours=30   # 允许的滞后
 *   node scripts/check-deploy-freshness.mjs --json
 *   node scripts/check-deploy-freshness.mjs --root=DIR           # 指定仓库根（测试用）
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE = "https://www.zorotreeking.online";
/** 一次部署到内容落地之间允许的正常滞后：构建 7 分钟 + 队列，给足 30 小时。 */
const DEFAULT_MAX_LAG_HOURS = 30;

/** 和 check-freshness.mjs 同一组流水线：日报两条 + 复盘一条。 */
export const STREAMS = [
  { id: "ai-digest", dir: "ai", pattern: /^digest-(\d{4}-\d{2}-\d{2})\.zh\.mdx$/ },
  { id: "invest-digest", dir: "invest", pattern: /^digest-(\d{4}-\d{2}-\d{2})\.zh\.mdx$/ },
  { id: "invest-recap", dir: "invest", pattern: /^market-recap-(\d{4}-\d{2}-\d{2})\.zh\.mdx$/ },
];

/** 从文件名列表里取最新日期（YYYY-MM-DD 可直接字符串比较）。 */
export function newestDate(names, pattern) {
  let newest = null;
  for (const name of names) {
    const hit = pattern.exec(name);
    if (hit && (newest === null || hit[1] > newest)) newest = hit[1];
  }
  return newest;
}

/** 北京时间某天的 YYYY-MM-DD。 */
export function beijingDay(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 纯函数：判定这次部署是不是已经包含了最新内容。
 *
 * @param {object} input
 * @param {{id: string, newest: string|null, liveStatus: number|null}[]} input.streams
 * @param {string|null} input.builtAt  deploy-meta.json 的 built_at（ISO）
 * @param {number} input.maxLagHours  允许的滞后
 * @param {Date} input.now
 * @returns {{ok: boolean, problems: string[], notes: string[]}}
 */
export function judgeDeployFreshness({ streams, builtAt, maxLagHours = DEFAULT_MAX_LAG_HOURS, now = new Date() }) {
  const problems = [];
  const notes = [];
  if (!builtAt) {
    problems.push("线上读不到 deploy-meta.json 的构建时间：无法判断这次部署是什么时候发的");
    return { ok: false, problems, notes };
  }
  const builtMs = new Date(builtAt).getTime();
  if (Number.isNaN(builtMs)) {
    problems.push(`deploy-meta.json 的 built_at 不是合法时间：${builtAt}`);
    return { ok: false, problems, notes };
  }
  const builtDay = beijingDay(builtAt);
  notes.push(`线上构建于 ${builtAt}（北京时间 ${builtDay}）`);

  for (const stream of streams) {
    if (!stream.newest) continue;
    // 1) 内容日期晚于构建日 → 这篇不可能在这次部署里
    if (stream.newest > builtDay) {
      problems.push(
        `${stream.id} 最新内容是 ${stream.newest}，而线上构建于 ${builtDay} —— 内容进了仓库但没上线`,
      );
    }
    // 2) 线上那一页实际是 404 → 内容确实没发出去
    if (stream.liveStatus === 404) {
      problems.push(`${stream.id} 最新一期 ${stream.newest} 在线上是 404：仓库有、站点没有`);
    } else if (stream.liveStatus && stream.liveStatus >= 500) {
      problems.push(`${stream.id} 最新一期 ${stream.newest} 在线上返回 ${stream.liveStatus}（站点自身故障）`);
    }
  }

  // 3) 兜底：部署本身太旧（哪怕内容日期对得上，也说明部署流水线停了）
  const lagHours = (now.getTime() - builtMs) / 3600_000;
  if (lagHours > maxLagHours) {
    problems.push(`线上最后一次构建是 ${lagHours.toFixed(1)} 小时前（上限 ${maxLagHours} 小时）—— 部署流水线可能停了`);
  } else {
    notes.push(`距上次构建 ${lagHours.toFixed(1)} 小时（上限 ${maxLagHours}）`);
  }
  return { ok: problems.length === 0, problems, notes };
}

/** 内容路径：日报/复盘在中文站是 /ai/digest-…/ 与 /invest/market-recap-…/ */
export function contentPath(streamId, date) {
  if (streamId === "ai-digest") return `/ai/digest-${date}/`;
  if (streamId === "invest-digest") return `/invest/digest-${date}/`;
  if (streamId === "invest-recap") return `/invest/market-recap-${date}/`;
  return null;
}

async function headStatus(base, route, { timeoutMs = 15000 } = {}) {
  try {
    const res = await fetch(new URL(route, base), {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status;
  } catch {
    return null;
  }
}

export async function collect(root = ROOT, base = DEFAULT_BASE) {
  const streams = [];
  for (const stream of STREAMS) {
    let names = [];
    try {
      names = await readdir(path.join(root, "src", "content", stream.dir));
    } catch {
      continue;
    }
    const newest = newestDate(names, stream.pattern);
    const route = newest ? contentPath(stream.id, newest) : null;
    const liveStatus = route ? await headStatus(base, route) : null;
    streams.push({ id: stream.id, newest, liveStatus });
  }
  let builtAt = null;
  try {
    const res = await fetch(new URL("/deploy-meta.json", base), {
      signal: AbortSignal.timeout(15000),
      headers: { "cache-control": "no-cache" },
    });
    if (res.ok) builtAt = (await res.json().catch(() => null))?.built_at ?? null;
  } catch {
    builtAt = null;
  }
  return { streams, builtAt };
}

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE, maxLagHours: DEFAULT_MAX_LAG_HOURS, root: ROOT, json: false };
  for (const arg of argv) {
    if (arg.startsWith("--base=")) args.base = arg.slice("--base=".length);
    else if (arg.startsWith("--max-lag-hours=")) args.maxLagHours = Number(arg.slice("--max-lag-hours=".length));
    else if (arg.startsWith("--root=")) args.root = path.resolve(arg.slice("--root=".length));
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { streams, builtAt } = await collect(args.root, args.base);
  const verdict = judgeDeployFreshness({ streams, builtAt, maxLagHours: args.maxLagHours });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ streams, builtAt, ...verdict }, null, 2)}\n`);
  } else {
    console.log(`部署新鲜度（${args.base}）`);
    for (const s of streams) {
      const mark = s.liveStatus === 200 ? "✓" : s.liveStatus == null ? "?" : "✗";
      console.log(`  ${mark} ${s.id}：仓库最新 ${s.newest ?? "无"} · 线上 HTTP ${s.liveStatus ?? "读不到"}`);
    }
    for (const note of verdict.notes) console.log(`  · ${note}`);
    for (const problem of verdict.problems) console.log(`::error title=部署没跟上内容::${problem}`);
    console.log(verdict.ok ? "部署新鲜度正常" : `部署没跟上内容（${verdict.problems.length} 条）`);
  }
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
