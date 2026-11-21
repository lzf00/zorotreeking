/**
 * 「内部断档」不该变成"每次部署都白跑一次 LLM"（第 147 轮）。
 *
 * 第 138 轮加了内部断档检测：只看"最新一篇"是发现不了中间漏一天的。
 * 但第 145 轮查清了 11-19/11-20 的来源——抓取接口只暴露最新列表，历史日期抓不回来，
 * 这两天的断档**永远补不回来**。
 *
 * 于是出现一个自己制造的坑：部署的自愈步骤用 `check-freshness --max-age=2` 决定
 * "要不要补跑"，而这个判定永远为假（因为断档永远在），于是**每次部署都会试着补跑一遍**
 * ——浪费 LLM 调用，日志里天天写「检测到内容停更」，而内容其实是最新的。
 *
 * 修法：`--ignore-gaps` —— 断档照常打印，但只按"年龄/单语"判定要不要行动。
 * 这种"该报警"与"该动作"不是同一件事的区分，写死在这里。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { summarizeFreshness } from "../scripts/check-freshness.mjs";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const digest = (date: string) => [`digest-${date}.zh.mdx`, `digest-${date}.en.mdx`];
const recap = (date: string) => [`market-recap-${date}.zh.mdx`, `market-recap-${date}.en.mdx`];

/** 今天 11-22，只有 11-22 和 11-18 有内容（中间 19/20/21 断档）。 */
const filesWithGap = {
  "ai-digest": [...digest("2026-11-22"), ...digest("2026-11-18")],
  "invest-digest": [...digest("2026-11-22"), ...digest("2026-11-18")],
  "invest-recap": recap("2026-11-21"),
};

test("只看最新一篇时是新鲜的，但断档要让默认判定失败", () => {
  const strict = summarizeFreshness(filesWithGap, { today: "2026-11-22", maxAgeDays: 2 });
  assert.equal(strict.failing.length, 0, "最新篇是今天的，年龄不该判失败");
  assert.ok(strict.failingGaps.length > 0, "断档没被发现");
  assert.equal(strict.ok, false);

  const lenient = summarizeFreshness(filesWithGap, { today: "2026-11-22", maxAgeDays: 2, ignoreGaps: true });
  assert.equal(lenient.ok, true, "--ignore-gaps 时不该因为历史断档失败");
  assert.ok(lenient.failingGaps.length > 0, "断档仍要照常报告，只是不参与判定");
});

test("--ignore-gaps 不能掩盖真的停更", () => {
  const stale = summarizeFreshness(
    {
      "ai-digest": digest("2026-11-15"),
      "invest-digest": digest("2026-11-15"),
      "invest-recap": recap("2026-11-21"),
    },
    { today: "2026-11-22", maxAgeDays: 2, ignoreGaps: true },
  );
  assert.equal(stale.ok, false, "7 天没更新必须仍然失败");
  assert.ok(stale.failing.some((row: any) => row.id === "ai-digest"));
});

test("需要动作的调用方都带 --ignore-gaps，需要报警的保留完整判定", async () => {
  const deploy = await read(".github/workflows/deploy.yml");
  assert.match(deploy, /check-freshness\.mjs --max-age=2 --ignore-gaps/, "部署自愈会把断档当成停更，白跑 LLM");
  const daily = await read(".github/workflows/daily-digest.yml");
  assert.match(daily, /--require-today --max-age=1 --ignore-gaps/);
  // 看门狗与周巡检是给人看的，保留完整判定（断档要写进 issue/报告）
  const watch = await read(".github/workflows/freshness-watch.yml");
  assert.doesNotMatch(watch, /--ignore-gaps/, "看门狗不该忽略断档");
});

test("措辞不再骗人：历史断档写「补不回来」", async () => {
  const script = await read("scripts/check-freshness.mjs");
  // 只看输出格式化那一段，别把注释也算进去
  const formatBlock = script.slice(script.indexOf("export function formatFreshness"), script.indexOf("async function loadFiles"));
  assert.match(formatBlock, /窗口已过，补不回来/);
  assert.doesNotMatch(formatBlock, /还来得及补/, "抓取接口只给最新列表，历史断档补不回来");
});
