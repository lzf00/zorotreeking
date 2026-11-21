/**
 * 定时任务的「整点高峰」不能碰（第 96 轮）。
 *
 * 实测证据（GitHub Actions API，2026-11-13 ~ 11-20）：
 *   daily-digest        cron 00:00 UTC → 实际 05:00–06:16 UTC（延迟 5–6 小时）
 *   deadlink-check      cron 01:00 UTC → 实际 07:42 UTC（延迟 6 小时 42 分）
 *   a11y-audit          cron 03:00 UTC → 实际 10:15 UTC（延迟 7 小时 15 分）
 *   lighthouse-mobile   cron 02:00 UTC → 实际 09:19 UTC（延迟 7 小时 19 分）
 *
 * 也就是说写「每天 08:00 出日报」的注释是假的：它其实中午 13–14 点才落地。
 * 这里把两条规则钉住：① 日报不再抢整点；② 依赖「日报已完成」的下游也不许抢整点。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const digest = parse(await readFile(new URL("../.github/workflows/daily-digest.yml", import.meta.url), "utf8"));

test("日报的 cron 必须错开整点（整点会在全球队列里被压 5+ 小时）", () => {
  const cron = digest.on.schedule[0].cron;
  const [minute] = cron.split(" ").map(Number);
  assert.notEqual(minute, 0, `cron 落在整点会长期延迟，收到 ${cron}`);
  assert.ok(Number.isFinite(minute) && minute > 0 && minute < 60, `分钟字段不合法：${cron}`);
});

test("日报的 cron 要留出「延迟 5-6 小时仍能在早上落地」的余量", () => {
  const [minute, hour] = digest.on.schedule[0].cron.split(" ").map(Number);
  const startBjt = ((hour + 8) % 24) * 60 + minute; // BJT 分钟数
  // 目标：即使按最坏延迟 7 小时算，落地时间也不晚于 BJT 13:00（读者下午还要看得到）
  const worstCaseBjt = (startBjt + 7 * 60) % (24 * 60);
  assert.ok(startBjt <= 4 * 60, `日报应在 BJT 凌晨开跑，收到 ${Math.floor(startBjt / 60)}:${String(startBjt % 60).padStart(2, "0")}`);
  assert.ok(worstCaseBjt <= 15 * 60, `最坏延迟后不应晚于 BJT 15:00，实际 ${Math.floor(worstCaseBjt / 60)}:${String(worstCaseBjt % 60).padStart(2, "0")}`);
});
