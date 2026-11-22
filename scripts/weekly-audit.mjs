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
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compare, parseJsonl, summarize } from "./lib/audit-summary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_BASELINE = path.join(ROOT, "src", "data", "audit-site-baseline.json");
const STAMP = path.join(ROOT, "src", "data", "weekly-audit.json");
const REPORT_DIR = path.join(ROOT, "reports");
const SITE = "https://www.zorotreeking.online";

const argv = process.argv.slice(2);
const valueOf = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const MAX_AGE_DAYS = Number(valueOf("max-age-days") ?? 7);
const FORCE = argv.includes("--force");
const DRY_RUN = argv.includes("--dry-run");

const now = new Date();

/** 给后续步骤一个明确信号：这次是"跳过"还是"真跑了"。 */
function emitOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  try {
    appendFileSync(outputPath, `${name}=${value}\n`);
  } catch {
    /* 本地跑没有这个文件，忽略 */
  }
}
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
    emitOutput("skipped", "true");
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
  // 自动化体检（第 179 轮）：前两轮的故障都不是"站点坏了"，而是 workflow 悄悄死了 ——
  // 日报 cron 四天 startup_failure、停更报警器自己红在第一步。站点全绿、只有产出没了。
  // 这条检查反过来问：每个 workflow 上次成功是什么时候？跟它自己的 cron 频率比是否逾期？
  // 读的是 Actions API（有 GITHUB_TOKEN 就不受限流影响），失败只算"一项有告警"，不挡部署。
  results.push(await run("自动化体检（workflow 是否还在跑）", process.execPath, ["scripts/check-automation-health.mjs"], 120_000));
  // 站外链接：5535 条全抓要十几分钟，装不进部署。缓存提交在仓库里（reports/ 是 gitignore 的，
  // 所以放 src/data/）、每次最多刷 900 条，
  // 六周左右轮完一遍；缓存过期（7 天）的条目才会真的重新抓。
  // 外链体检是从 dist 里收集 URL 的：没有 dist 就会「0 条链接、顺利通过」—— 沉默的假绿。
  const hasDist = existsSync(path.join(ROOT, "dist"));
  if (!hasDist) {
    console.log("⏭️  没有 dist，跳过站外链接体检（这个检查是从构建产物里收集 URL 的，不跑构建跑不出东西）");
  } else results.push(
    await run(
      "站外链接体检（分批）",
      process.execPath,
      ["scripts/check-external-links.mjs", "--json", "--limit", "900", "--cache=src/data/external-links-cache.json"],
      600_000,
    ),
  );

  // 全量巡检（site-audit.yml 本体）：把 sitemap 里每一页都真的加载一次，找"某一类页面集体坏掉"。
  // 抽样 21 页的 check-runtime 永远覆盖不到长尾（800+ 相册页、几十条路线页、几百篇日报）。
  // 实测 1192 页 ~200 秒，只在每周跑一次。
  let siteAuditNote = "";
  if (hasDist) {
    const auditOut = path.join(REPORT_DIR, `audit-site-${isoDay(now)}.jsonl`);
    // audit-site 是 --resume 友好的**追加**写：同一天跑两次就会变成 2384 页、
    // 中位数被两次结果混在一起（第 158 轮实测）。每周巡检要的是"这一次全站的样子"，
    // 先删掉当天的旧文件。
    rmSync(auditOut, { force: true });
    results.push(await run(
      "全量巡检（每页都真加载）",
      process.execPath,
      ["scripts/audit-site.mjs", "--concurrency=4", `--out=${path.relative(ROOT, auditOut)}`],
      900_000,
    ));
    // 体积趋势：单看一周没意义，三个月涨 40% 才要命。所以记基线、只报明显变重。
    try {
      const stats = summarize(parseJsonl(readFileSync(auditOut, "utf8")));
      const baseline = existsSync(AUDIT_BASELINE)
        ? JSON.parse(readFileSync(AUDIT_BASELINE, "utf8"))
        : null;
      const verdict = compare(stats, baseline);
      siteAuditNote =
        `全量巡检 ${stats.pages} 页：中位 ${stats.medianKB} KB · p95 ${stats.p95KB} KB` +
        (baseline?.p95KB ? `（基线 p95 ${baseline.p95KB} KB）` : "（首次记录基线）") +
        (verdict.ok ? " ✅ 无异常" : ` ⚠️ ${verdict.problems.join("；")}`);
      console.log(siteAuditNote);
      if (!verdict.ok) {
        console.log(`::warning title=每周巡检·体积趋势::${verdict.problems.join("；")}`);
      }
      if (!DRY_RUN) {
        writeFileSync(
          AUDIT_BASELINE,
          `${JSON.stringify(
            {
              updatedAt: isoDay(now),
              pages: stats.pages,
              failed: stats.failed,
              medianKB: stats.medianKB,
              p95KB: stats.p95KB,
              heaviest: stats.heaviest,
            },
            null,
            2,
          )}\n`,
        );
      }
    } catch (error) {
      siteAuditNote = `体积趋势统计失败：${error?.message ?? error}`;
      console.log(`::warning title=每周巡检·体积趋势::${siteAuditNote}`);
    }
  } else {
    console.log("⏭️  没有 dist，跳过全量巡检（它要逐页加载构建产物）");
  }

  // 完整 a11y 巡检（64 项，明暗两套）：这是 a11y.yml 的唯一内容，cron 从没触发过。
  // 只在这一步有 dist 的前提下跑；chromium 由 build-and-deploy 前面的步骤装好。
  if (hasDist) {
    results.push(await run("无障碍（完整 64 项）", process.execPath, ["scripts/check-a11y.mjs", "--dist"], 900_000));
  } else {
    console.log("⏭️  没有 dist，跳过完整 a11y 巡检（它查的是构建产物）");
  }

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
      ...(siteAuditNote ? ["## 体积趋势", "", siteAuditNote, ""] : []),
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
    // 提交步骤可能失败（reports/ 是 gitignore 的），所以报告内容同时写进 step summary：
    // 这样"巡检跑过没有、结果怎样"永远能从 CI 页面上看到，不只依赖那次 commit。
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        appendFileSync(summaryPath, `${lines.join("\n")}\n`);
      } catch (error) {
        console.log(`（step summary 写入失败：${error?.message ?? error}）`);
      }
    }
  } else {
    console.log("\n（--dry-run：不写报告和戳记）");
  }

  emitOutput("skipped", "false");
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
