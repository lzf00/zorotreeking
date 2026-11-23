#!/usr/bin/env node
/**
 * 「这个周期性审计该跑了吗？」（第 182 轮，从 a11y-due 通用化）
 *
 * 背景：这个仓库的 `schedule` 实测会延迟 5–7.5 小时、甚至整周不触发。第 179 轮的自动化
 * 体检第一次跑就报出 **a11y.yml / site-audit.yml 从来没有运行记录** —— 写了四个月的
 * 「每周全站巡检」，一行都没执行过。a11y 在 180 轮改用「部署后醒一次 + 按戳记判断是否
 * 到期」，立刻真跑起来了（第一次就抓到一处真实对比度违规）。
 *
 * 182 轮把同一套判定抽出来：site-audit（全站巡检）和 lighthouse-mobile（移动端跑分）
 * 复制这个模式 —— cron 留在原地当备份，可靠的触发源换成 `workflow_run: Build & Deploy`。
 *
 * 用法（在 workflow 里）：
 *   node scripts/audit-due.mjs --stamp=src/data/site-audit.json --max-age-days=7
 *       → 该跑：把 due=true 写进 $GITHUB_OUTPUT；不该跑：due=false。退出码恒 0。
 *   node scripts/audit-due.mjs --stamp=... --max-age-days=7 --force   # 手动触发一律跑
 *   node scripts/audit-due.mjs --stamp=... --json                      # 机器可读，不写 output
 *
 * 为什么退出码恒 0：这是「排程决策」，不是「判定结果」。真正的红线由审计脚本自己定。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
export const A11Y_STAMP = path.join(ROOT, "src", "data", "a11y-audit.json");

/**
 * 纯逻辑：上一次成功审计的时间戳 + 现在 + 宽限期 → 该不该跑。
 * 时间戳缺失/损坏一律视为「该跑」（宁多跑一次，不要静默跳过）。
 */
export function decideDue(ranAt, now = new Date(), maxAgeDays = 7) {
  const last = ranAt ? new Date(ranAt) : null;
  if (!last || Number.isNaN(last.getTime())) {
    return { due: true, ageDays: null, reason: "没有审计戳记（从没跑过或戳记损坏）" };
  }
  const ageDays = (now.getTime() - last.getTime()) / 86_400_000;
  if (ageDays < maxAgeDays) {
    return {
      due: false,
      ageDays,
      reason: `上次 ${last.toISOString().slice(0, 10)}（${ageDays.toFixed(1)} 天前），还没到 ${maxAgeDays} 天`,
    };
  }
  return {
    due: true,
    ageDays,
    reason: `上次 ${last.toISOString().slice(0, 10)}（${Math.floor(ageDays)} 天前），已超过 ${maxAgeDays} 天`,
  };
}

/** 戳记文件里的 ranAt（读不到就当没跑过）。 */
export function readStamp(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function main(argv = process.argv.slice(2), defaultStamp = A11Y_STAMP) {
  const valueOf = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const stampFile = valueOf("stamp") ? path.resolve(ROOT, valueOf("stamp")) : defaultStamp;
  const maxAgeDays = Number(valueOf("max-age-days") ?? 7);
  const force = argv.includes("--force");
  const jsonOut = argv.includes("--json");

  const stamp = existsSync(stampFile) ? readStamp(stampFile) : null;
  const decision = force
    ? { due: true, ageDays: null, reason: "手动强制（--force）" }
    : decideDue(stamp?.ranAt, new Date(), maxAgeDays);

  if (jsonOut) {
    console.log(JSON.stringify({ ...decision, force, stamp: path.relative(ROOT, stampFile), stampContent: stamp }, null, 2));
    return 0;
  }

  console.log(`${decision.due ? "▶︎ 该跑了" : "⏭️ 跳过"}（${path.relative(ROOT, stampFile)}）：${decision.reason}`);
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    try {
      appendFileSync(
        outputPath,
        `due=${decision.due}\nage_days=${decision.ageDays ?? ""}\nreason=${decision.reason}\n`,
      );
    } catch {
      /* 本地跑没有这个文件 */
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
