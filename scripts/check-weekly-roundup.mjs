#!/usr/bin/env node
/**
 * 「本周看点」有没有产出（第 161 轮）。
 *
 * 起因：`weekly-roundup.yml` 只靠 cron（北京时间周日 09:00）。这个仓库的 schedule
 * 实测会延迟 5–7.5 小时、甚至整天不触发（日报就这样停更过三天）。周日一旦没跑，
 * 「本周看点」就永久缺一期 —— 而站点照常构建、门禁全绿、没人会发现。
 *
 * 判据（只看文件，不联网）：
 *   目标周 = 最近一个周日的 ISO 周。
 *     今天就是周日 → 本周；周一到周六 → 上一个（已经结束的）周。
 *   这样既不会"提前生成半周内容"，也能补上错过的周日。
 *
 * 退出码：
 *   0  目标周已有 zh + en
 *   10 缺 zh（该生成）
 *   11 有 zh 缺 en（该翻译）
 *
 * 用法：
 *   node scripts/check-weekly-roundup.mjs
 *   node scripts/check-weekly-roundup.mjs --json
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AI_DIR = path.join(ROOT, "src", "content", "ai");

const pad = (n) => String(n).padStart(2, "0");

/** 北京时间下的年月日 + 星期（0=周日）。全站时间口径都是北京时间。 */
export function beijingParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * ISO 8601 周：周一为一周的开始，含当年第一个周四的那周是第 1 周。
 * 纯计算，便于单测（跨年边界最容易写错：2027-01-01 属于 2026-W53）。
 */
export function isoWeek(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const utcDay = date.getUTCDay() || 7; // 周日算 7
  // 挪到本周四：ISO 周号由"这一周的周四"决定
  date.setUTCDate(date.getUTCDate() + 4 - utcDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date - yearStart) / 86_400_000 + 1) / 7);
  return { year: isoYear, week };
}

/** 目标周：最近一个周日的 ISO 周。 */
export function targetWeek(now = new Date()) {
  const { weekday } = beijingParts(now);
  // 周日(0) → 今天；否则回退到上一个周日（1..6 天前）
  const backoff = weekday === 0 ? 0 : weekday;
  const target = new Date(now.getTime() - backoff * 86_400_000);
  const { year, month, day } = beijingParts(target);
  return isoWeek(year, month, day);
}

export const weekLabel = ({ year, week }) => `${year}-W${pad(week)}`;
export const roundupPaths = (label) => ({
  zh: path.join(AI_DIR, `weekly-${label}.zh.mdx`),
  en: path.join(AI_DIR, `weekly-${label}.en.mdx`),
});

/** 纯判定：给两个"是否存在"，返回状态。 */
export function roundupState({ zh, en }) {
  if (!zh) return { state: "missing-zh", exitCode: 10, message: "缺中文版，需要生成" };
  if (!en) return { state: "missing-en", exitCode: 11, message: "有中文缺英文版，需要翻译" };
  return { state: "ok", exitCode: 0, message: "中英都在" };
}

function main() {
  const json = process.argv.includes("--json");
  const week = targetWeek();
  const label = weekLabel(week);
  const files = roundupPaths(label);
  const verdict = roundupState({ zh: existsSync(files.zh), en: existsSync(files.en) });
  if (json) {
    console.log(JSON.stringify({ week: label, ...verdict }, null, 2));
  } else {
    console.log(`${label}：${verdict.message}（exit ${verdict.exitCode}）`);
  }
  process.exit(verdict.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
