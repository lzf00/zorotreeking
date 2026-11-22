#!/usr/bin/env node
/**
 * 每周巡检，搭部署的顺风车（第 153 轮）。
 *
 * 起因：`site-audit.yml` / `a11y.yml` / `freshness-watch.yml` 三个 workflow 都靠
 * `schedule: cron` 触发，而实测 schedule **会整周不触发**（第 145 轮发现，日报停更两天
 * 就是同一个原因）。于是这三个巡检实际上从没跑过 —— 它们的存在只是让人以为"有人在看"。
 *
 * 独立调度器（launchd / 外部 cron）要改运行环境，得人来定；但"部署时顺手补一次"
 * 不需要任何新依赖，和 catch-up-digest / refresh-us-macro 是同一套自愈模式。
 *
 * 判旧才跑：`src/data/weekly-audit.json` 记着上次跑的时间，7 天内直接跳过。
 *
 * 设计约束：
 *   - **永远不挡发布**：巡检发现问题只写报告 + 注解，退出码 0；
 *     只有脚本自己崩了才 exit 2（那才是真的需要人看）。
 *   - 报告进 `reports/weekly-audit-<date>.md`，和已有的 deadlinks-*.json 同类归档。
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAMP = path.join(ROOT, "src", "data", "weekly-audit.json");
const REPORT_DIR = path.join(ROOT, "reports");
const SITE = "https://www.zorotreeking.online";

const argv = process.argv.slice(2);
const valueOf = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const MAX_AGE_DAYS = Number(valueOf("max-age-days") ?? 7);
const FORCE = argv.includes("--force");
const DRY_RUN = argv.includes("--dry-run");

const now = new Date();
const isoDay = (date) => date.toISOString().slice(0, 10);

function readStamp() {
  try {
    return JSON.parse(readFileSync(STAMP, "utf8"));
  } catch {
    return null;
  }
}

/** 跑一条巡检命令：返回 {ok, code, tail, ms}，任何失败都变成数据而不是异常。 */
function run(label, command, args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(command, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({
        label,
        ok: code === 0,
        code,
        ms: Date.now() - started,
        tail: output.split("\n").slice(-12).join("\n"),
      });
    });
  });
}

async function main() {
  const stamp = readStamp();
  const lastRun = stamp?.ranAt ? new Date(stamp.ranAt) : null;
  const ageDays = lastRun ? (now.getTime() - lastRun.getTime()) / 86_400_000 : Infinity;

  if (!FORCE && ageDays < MAX_AGE_DAYS) {
    const nextDue = new Date(lastRun.getTime() + MAX_AGE_DAYS * 86_400_000);
    console.log(
      `⏭️  每周巡检还在有效期内：上次 ${isoDay(lastRun)}（${ageDays.toFixed(1)} 天前），下次 ${isoDay(nextDue)} 之后。`,
    );
    return 0;
  }

  console.log(
    `▶︎  跑每周巡检（上次：${lastRun ? `${isoDay(lastRun)}，${ageDays.toFixed(1)} 天前` : "从没跑过"}）`,
  );

  const results = [];
  results.push(await run("行情/宏观快照年龄", process.execPath, ["scripts/check-market-data-age.mjs", "--json"], 60_000));
  // --ignore-gaps：11-19/11-20 那两天的历史断档抓不回来（欠账 #12），
  // 不带这个参数等于每周都报一次同一个不可能修的错。断档本身仍会打在报告里。
  results.push(await run("内容更新节奏", process.execPath, ["scripts/check-freshness.mjs", "--ignore-gaps"], 120_000));
  // 站外链接：5535 条全抓要十几分钟，装不进部署。缓存提交在仓库里、每次最多刷 900 条，
  // 六周左右轮完一遍；缓存过期（7 天）的条目才会真的重新抓。
  // 外链体检是从 dist 里收集 URL 的：没有 dist 就会「0 条链接、顺利通过」—— 沉默的假绿。
  const hasDist = existsSync(path.join(ROOT, "dist"));
  if (!hasDist) {
    console.log("⏭️  没有 dist，跳过站外链接体检（这个检查是从构建产物里收集 URL 的，不跑构建跑不出东西）");
  } else results.push(
    await run(
      "站外链接体检（分批）",
      process.execPath,
      ["scripts/check-external-links.mjs", "--json", "--limit", "900", "--cache=reports/external-links-cache.json"],
      600_000,
    ),
  );

  for (const result of results) {
    const mark = result.ok ? "✅" : "⚠️";
    console.log(`${mark} ${result.label}（${(result.ms / 1000).toFixed(1)}s，exit ${result.code}）`);
    if (!result.ok) console.log(`::warning title=每周巡检·${result.label}::有一条需要看，详见 reports/weekly-audit-${isoDay(now)}.md`);
  }

  const reportPath = path.join(REPORT_DIR, `weekly-audit-${isoDay(now)}.md`);
  if (!DRY_RUN) {
    mkdirSync(REPORT_DIR, { recursive: true });
    const lines = [
      `# 每周巡检 ${isoDay(now)}`,
      "",
      `触发方式：部署时补跑（cron 为什么不靠谱见 scripts/weekly-audit.mjs 顶部注释）。`,
      "",
      "| 检查 | 结果 | 耗时 |",
      "|---|---|---|",
      ...results.map((r) => `| ${r.label} | ${r.ok ? "通过" : "有告警"} | ${(r.ms / 1000).toFixed(1)}s |`),
      "",
      ...results.flatMap((r) => [
        `## ${r.label}`,
        "",
        "```",
        r.tail || "（没有输出）",
        "```",
        "",
      ]),
    ];
    writeFileSync(reportPath, lines.join("\n"));

    writeFileSync(
      STAMP,
      `${JSON.stringify(
        {
          ranAt: now.toISOString(),
          checks: results.map((r) => ({ label: r.label, ok: r.ok, ms: r.ms })),
          report: path.relative(ROOT, reportPath),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\n报告：${path.relative(ROOT, reportPath)}`);
  } else {
    console.log("\n（--dry-run：不写报告和戳记）");
  }

  console.log(`::notice title=每周巡检完成::${results.filter((r) => !r.ok).length}/${results.length} 项有告警，已写入 reports/`);
  return 0;
}

main().then(
  (code) => process.exit(code ?? 0),
  (error) => {
    console.error(`✗ 每周巡检脚本自身出错：${error?.stack ?? error}`);
    process.exit(2);
  },
);
