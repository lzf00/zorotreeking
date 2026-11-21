#!/usr/bin/env node
/**
 * 内容新鲜度看门狗：**没有产出**也要能被发现。
 *
 * 背景（第 78 轮）：AI 日报从 2026-11-18 之后就再没出现，而投资复盘照常更新 ——
 * 站点照样构建、门禁全绿、巡检 0 失败，因为「少一篇文章」不是错误，只是内容不再更新。
 * 这种静默停更像水管漏水：没人看就永远不会修。定时任务里缺一个「今天到底产出了没」的
 * 断言，所以补这个脚本。
 *
 * 它只读 `src/content/` 的文件名（`digest-YYYY-MM-DD.*` / `market-recap-YYYY-MM-DD.*`），
 * 不读文件内容、不联网，所以可以在任何地方跑。
 *
 * 用法：
 *   node scripts/check-freshness.mjs                     # 表格 + 退出码
 *   node scripts/check-freshness.mjs --max-age=2
 *   node scripts/check-freshness.mjs --max-age=2 --ignore-gaps   # 只按年龄/单语判定（部署自愈用）         # 允许落后几天（默认 2）
 *   node scripts/check-freshness.mjs --require-today     # 今天必须有产出（日报流水线收尾用）
 *   node scripts/check-freshness.mjs --json              # 机器可读
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "src", "content");

/** 每条内容流水线：名字、目录、文件名里的日期格式、期望节奏、怎么算「今天该有」。 */
export const STREAMS = [
  {
    id: "ai-digest",
    label: "AI 日报",
    dir: "ai",
    pattern: /^digest-(\d{4}-\d{2}-\d{2})\.(zh|en)\.mdx$/,
    cadenceDays: 1,
  },
  {
    // 第 115 轮补：投资日报是 `digest-YYYY-MM-DD`，以前没被任何一条流水线盯住 ——
    // 盯的是周报 `market-recap-*`，所以"投资日报停更"这件事从来没被发现过。
    id: "invest-digest",
    label: "投资日报",
    dir: "invest",
    pattern: /^digest-(\d{4}-\d{2}-\d{2})\.(zh|en)\.mdx$/,
    cadenceDays: 1,
  },
  {
    // 复盘同样是每日一篇（market-recap 每天都有），所以节奏也是 1 天。
    id: "invest-recap",
    label: "投资复盘",
    dir: "invest",
    pattern: /^market-recap-(\d{4}-\d{2}-\d{2})\.(zh|en)\.mdx$/,
    cadenceDays: 1,
    // 复盘只跟交易日走：实测 122 篇全部落在周一至周五（周末不写）。
    // 不写这一条，断档检测会把每个周末都报成"漏了一天"—— 那是纯噪声。
    weekdaysOnly: true,
  },
];

/** 北京时间今天（UTC+8，无夏令时）。 */
export function beijingToday(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const dayNumber = (isoDate) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

/** (from, to] 之间的交易日数（周一至周五）。只给"只跟交易日走"的流水线用。 */
export function weekdaysBetween(from, to) {
  let count = 0;
  for (let day = dayNumber(from) + 1; day <= dayNumber(to); day += 1) {
    const weekday = new Date(day * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/**
 * 纯函数：找出"单语日"。
 *
 * 第 115 轮加这条的真实原因：全站模板按中英成对处理（语言切换、hreflang、站内链接检查
 * 都假设 en 存在）。上面那只"停更"看门狗只看**最新一篇的日期**，所以"今天有中文日报、
 * 但英文没翻出来"会被判成 ✅ —— 而站点上这是两条 `/en/...` 死链，部署门禁会红。
 * 也就是说：内容看着新鲜，站点却发不出去。所以把"成对"也纳入健康度。
 */
export function bilingualGaps(filesByStream, { today = beijingToday(), days = 3 } = {}) {
  const gaps = [];
  for (const stream of STREAMS) {
    const files = filesByStream[stream.id] ?? [];
    const byDate = new Map();
    for (const name of files) {
      const match = stream.pattern.exec(name);
      if (!match) continue;
      const [, date, lang] = match;
      if (daysBetween(date, today) > days || daysBetween(date, today) < 0) continue;
      if (!byDate.has(date)) byDate.set(date, new Set());
      byDate.get(date).add(lang);
    }
    for (const [date, langs] of [...byDate].sort()) {
      const missing = ["zh", "en"].filter((lang) => !langs.has(lang));
      if (missing.length) gaps.push({ stream: stream.id, label: stream.label, date, missing });
    }
  }
  return gaps;
}

/**
 * 纯函数：找出**内部断档**（第 138 轮）。
 *
 * 上面那只"停更"看门狗只看**最新一篇的日期**，所以 2026-11-19、11-20 两份投资日报
 * 直接消失、11-21 又恢复的情况会被判成 ✅ —— 因为最新一篇是"昨天"，落后 1 天，没问题。
 * 也就是说：流水线可以连续漏几天，只要最后一天成功，看门狗就一直闭嘴。
 *
 * 这里在最近 `days` 天里逐日检查"该有的那天有没有"，把漏掉的具体日期列出来。
 *
 * 分级：漏的日期离今天很近（≤ `recentDays`）算 fail —— 值得人工看一眼；
 * 更早的算 warn —— 只留记录。
 * 注意（第 147 轮查清）：抓取接口只暴露"最新列表"，**任何历史日期都补不回来**，
 * 所以 fail 的含义只是"这事儿新鲜，别错过"，不是"还能自动补"。
 * 也正因为如此，判断"要不要现在去抓一次"的地方（部署自愈、日更 workflow）要用
 * `--ignore-gaps`，否则会天天误判停更、白跑 LLM。
 */
export function internalGaps(filesByStream, { today = beijingToday(), days = 7, recentDays = 2 } = {}) {
  const gaps = [];
  const todayNumber = dayNumber(today);
  for (const stream of STREAMS) {
    if (stream.cadenceDays > 1) continue; // 周报之类不按日检查
    const files = filesByStream[stream.id] ?? [];
    const have = new Set();
    for (const name of files) {
      const date = stream.pattern.exec(name)?.[1];
      if (date) have.add(date);
    }
    let newest = null;
    let oldest = null;
    for (const date of have) {
      if (!newest || date > newest) newest = date;
      if (!oldest || date < oldest) oldest = date;
    }
    if (!newest) continue; // 一篇都没有由 summarizeFreshness 报"停更"，不在这里重复
    // 从 newest 往前看 days 天：今天还没有产物是正常的（流水线早上才跑），所以不含今天
    // 只看"有历史记录之后"的窗口：流水线还没上线的那段不算断档
    const earliest = Math.max(todayNumber - days, dayNumber(oldest));
    for (let day = todayNumber - 1; day >= earliest; day -= 1) {
      const back = todayNumber - day;
      const iso = new Date(day * 86_400_000).toISOString().slice(0, 10);
      if (iso > newest) continue; // 比最新一篇还新：还没到该有的日子
      if (have.has(iso)) continue;
      if (stream.weekdaysOnly) {
        const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
        if (weekday === 0 || weekday === 6) continue; // 周末本来就不产
      }
      gaps.push({
        stream: stream.id,
        label: stream.label,
        date: iso,
        level: back <= recentDays ? "fail" : "warn",
      });
    }
  }
  return gaps.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * 纯函数：把「文件名列表」变成新鲜度结论。可单测，不碰磁盘。
 *
 * @param {Record<string, string[]>} filesByStream 流 id → 文件名数组
 * @param {{ today?: string, maxAgeDays?: number, requireToday?: boolean }} options
 */
export function summarizeFreshness(filesByStream, { today = beijingToday(), maxAgeDays = 2, requireToday = false, ignoreGaps = false } = {}) {
  const rows = [];
  for (const stream of STREAMS) {
    const files = filesByStream[stream.id] ?? [];
    let newest = null;
    for (const name of files) {
      const date = stream.pattern.exec(name)?.[1];
      if (!date) continue;
      if (!newest || date > newest) newest = date;
    }
    // 只在交易日产出的流水线，周末不该算"落后"：周六看最新一篇（周五）是正常的
    const age = newest ? (stream.weekdaysOnly ? weekdaysBetween(newest, today) : daysBetween(newest, today)) : null;
    let level = "ok";
    let reason = "";
    if (!newest) {
      level = "fail";
      reason = "一篇都没有";
    } else if (requireToday && newest !== today) {
      level = "fail";
      reason = `今天（${today}）没有产出，最新是 ${newest}`;
    } else if (age > maxAgeDays) {
      level = "fail";
      reason = `已经 ${age} 天没有更新（最新 ${newest}，阈值 ${maxAgeDays} 天）`;
    } else if (age > stream.cadenceDays) {
      level = "warn";
      reason = `落后 ${age} 天（节奏 ${stream.cadenceDays} 天/篇）`;
    }
    rows.push({ ...stream, newest, age, level, reason, count: files.filter((name) => stream.pattern.test(name)).length });
  }
  // 单语日也算"发不出去"：站内链接检查会红，部署被拦。所以并入失败判定。
  const gaps = bilingualGaps(filesByStream, { today, days: Math.max(maxAgeDays, 1) });
  for (const gap of gaps) {
    const row = rows.find((r) => r.id === gap.stream);
    if (!row) continue;
    if (row.level !== "fail") {
      row.level = "fail";
      row.reason = `${gap.date} 缺 ${gap.missing.join("/")} 版（单语内容会让站内出现死链）`;
    }
  }
  // 内部断档：连续漏几天、最后一天又成功的情况，只看"最新一篇"是发现不了的
  const missingDays = internalGaps(filesByStream, { today, days: Math.max(maxAgeDays, 1) + 5 });
  const failingGaps = missingDays.filter((gap) => gap.level === "fail");
  const failing = rows.filter((row) => row.level === "fail");
  return {
    today,
    rows,
    failing,
    gaps,
    missingDays,
    failingGaps,
    // ignoreGaps：内部断档只报告不判定（第 147 轮）。
    // 为什么需要：部署的自愈步骤用 `--max-age=2` 决定"要不要补跑"，
    // 而 11-19/11-20 这种**抓取窗口已过的历史断档**永远补不回来 ——
    // 带上它判定，等于每次部署都误判"停更"，白跑一遍 LLM 抓取（实测 wasteful）。
    ok: failing.length === 0 && gaps.length === 0 && (ignoreGaps || failingGaps.length === 0),
  };
}

export function formatFreshness({ today, rows, ok, gaps, missingDays }) {
  const lines = [`内容新鲜度（北京时间 ${today}）`, "", "| 流水线 | 最新一篇 | 落后 | 篇数 | 结论 |", "| --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    const icon = row.level === "ok" ? "✅" : row.level === "warn" ? "⚠️" : "❌";
    lines.push(
      `| ${row.label} | ${row.newest ?? "—"} | ${row.age === null ? "—" : `${row.age} 天`} | ${row.count} | ${icon}${row.reason ? ` ${row.reason}` : ""} |`,
    );
  }
  if (gaps?.length) {
    lines.push("");
    lines.push("单语日（有中文没英文，或反过来）：");
    for (const gap of gaps) lines.push(`- ${gap.label} ${gap.date} 缺 ${gap.missing.join(" / ")}`);
  }
  if (missingDays?.length) {
    lines.push("");
    lines.push("内部断档（这些日期该有产出但没有）：");
    for (const gap of missingDays) {
      // 抓取接口只暴露"最新列表"，历史日期抓不回来 —— 别写成"还能补"骗人
      lines.push(`- ${gap.label} ${gap.date}${gap.level === "fail" ? "（窗口已过，补不回来，仅记录）" : "（已错过良久，仅记录）"}`);
    }
  }
  lines.push("");
  lines.push(ok ? "内容流水线正常" : "有流水线已经停更或产出不完整，请查对应 workflow 的运行日志");
  return lines.join("\n");
}

async function loadFiles() {
  const filesByStream = {};
  for (const stream of STREAMS) {
    try {
      filesByStream[stream.id] = await readdir(path.join(CONTENT, stream.dir));
    } catch {
      filesByStream[stream.id] = [];
    }
  }
  return filesByStream;
}

async function main() {
  const json = process.argv.includes("--json");
  const ignoreGaps = process.argv.includes("--ignore-gaps");
  const requireToday = process.argv.includes("--require-today");
  const maxAgeArg = process.argv.find((value) => value.startsWith("--max-age="));
  const maxAgeDays = maxAgeArg ? Number(maxAgeArg.slice("--max-age=".length)) : 2;

  const result = summarizeFreshness(await loadFiles(), { requireToday, maxAgeDays, ignoreGaps });
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${formatFreshness(result)}\n`);

  if (!result.ok) {
    const parts = [
      ...result.failing.map((row) => `${row.label}：${row.reason}`),
      ...result.gaps.map((gap) => `${gap.label} ${gap.date} 缺 ${gap.missing.join("/")}`),
    ];
    process.stderr.write(`::error title=内容流水线停更::${parts.join("；")}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
