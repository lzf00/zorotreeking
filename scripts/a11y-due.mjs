#!/usr/bin/env node
/**
 * 「这周的无障碍全站审计该跑了吗？」（第 180 轮）
 *
 * 背景：`a11y.yml` 只有 cron（每周二 04:30），而这个仓库的 cron 实测会延迟 5–7 小时、
 * 甚至整周不触发 —— 第 179 轮的自动化体检第一次跑就报出 **a11y.yml 从来没有运行记录**。
 * 也就是说：全站 1190 页 × 浅/深两套的 axe 审计一次都没跑过，无障碍保障只剩门禁里
 * 抽样 22 页的 `check:a11y:fast`。
 *
 * 修法和 157 轮把 site-audit 挂进 weekly-audit 一样：**换一个可靠的上游**。
 * 这里给 a11y.yml 加 `workflow_run: ["Build & Deploy"]` —— 每次部署后都醒一次，
 * 但只有「上次成功审计距今超过 max-age-days」才真的跑，否则 10 秒内退出。
 *
 * 用法（在 workflow 里）：
 *   node scripts/a11y-due.mjs --max-age-days=7          # 该跑 → exit 0 并把 due=true 写进 $GITHUB_OUTPUT
 *                                                       # 不该跑 → exit 0、due=false
 *   node scripts/a11y-due.mjs --max-age-days=7 --force  # 强制 due=true（手动触发用）
 *   node scripts/a11y-due.mjs --json                    # 机器可读，不写 output
 *
 * 退出码恒为 0：这是「排程决策」，不是「判定结果」；真正的红线由审计脚本自己决定。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAMP = path.join(ROOT, "src", "data", "a11y-audit.json");

const argv = process.argv.slice(2);
const valueOf = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const MAX_AGE_DAYS = Number(valueOf("max-age-days") ?? 7);
const FORCE = argv.includes("--force");
const JSON_OUT = argv.includes("--json");

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
    return { due: false, ageDays, reason: `上次 ${last.toISOString().slice(0, 10)}（${ageDays.toFixed(1)} 天前），还没到 ${maxAgeDays} 天` };
  }
  return { due: true, ageDays, reason: `上次 ${last.toISOString().slice(0, 10)}（${Math.floor(ageDays)} 天前），已超过 ${maxAgeDays} 天` };
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(STAMP, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const stamp = existsSync(STAMP) ? readStamp() : null;
  const decision = FORCE
    ? { due: true, ageDays: null, reason: "手动强制（--force）" }
    : decideDue(stamp?.ranAt, new Date(), MAX_AGE_DAYS);

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...decision, force: FORCE, stamp }, null, 2));
    return 0;
  }

  console.log(`${decision.due ? "▶︎ 该跑了" : "⏭️ 跳过"}：${decision.reason}`);
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    try {
      appendFileSync(outputPath, `due=${decision.due}\nage_days=${decision.ageDays ?? ""}\nreason=${decision.reason}\n`);
    } catch {
      /* 本地跑没有这个文件 */
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
