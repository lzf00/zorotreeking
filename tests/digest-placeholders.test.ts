/**
 * 占位符不许进正文（第 113 轮）。
 *
 * `assertSummaryHealth` 的阈值是"失败超过 30% 才不出稿"，于是 12 条里挂 1 条（8%）照发，
 * 读者在正文里看到「（LLM 摘要失败，请稍后手动补充）」。线上实测已有 **40 篇** 日报带这种
 * 占位符（2026-11-10 到 2026-11-21）。这轮把检查做成脚本，并接到部署补跑链路的质量闸上。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import { PLACEHOLDER_PATTERNS, inWindow, placeholdersIn } from "../scripts/check-digest-placeholders.mjs";

test("认得出脚本真正写进去的那几种占位符", () => {
  assert.deepEqual(placeholdersIn("正文正常，没有任何问题"), []);
  assert.deepEqual(placeholdersIn("（LLM 摘要失败，请稍后手动补充）"), ["LLM 摘要失败", "请稍后手动补充"]);
  assert.deepEqual(placeholdersIn("*（自动摘要失败，下面是原文节选，请手动改写）*"), ["自动摘要失败", "请手动改写"]);
  assert.ok(PLACEHOLDER_PATTERNS.length >= 4, "句式表太少，漏掉一种就等于放行");
});

test("时间窗：只看最近 N 天，历史遗留不算（否则一上来就红）", () => {
  assert.equal(inWindow("2026-11-21", "2026-11-21", 7), true);
  assert.equal(inWindow("2026-11-15", "2026-11-21", 7), true);
  assert.equal(inWindow("2026-11-10", "2026-11-21", 7), false, "10 号已经超出 7 天窗口");
  assert.equal(inWindow("2026-11-10", "2026-11-21", Infinity), true, "--all 时全量");
  assert.equal(inWindow("2026-11-30", "2026-11-21", 7), false, "未来日期不该算进窗口");
});

test("部署补跑链路有质量闸，过不了就回滚不发布", async () => {
  const wf = parse(await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"));
  const step = wf.jobs["catch-up-digest"].steps.find(
    (s: { name?: string }) => s.name === "Catch up a missed digest (self-healing)",
  );
  assert.ok(step, "找不到补跑步骤");
  const run: string = step.run ?? "";
  assert.match(run, /check-digest-placeholders\.mjs --days=0/, "补跑生成的当天内容必须先过占位符检查");
  assert.match(run, /git checkout -- src\/content/, "有占位符时要回滚，不能把半成品提交出去");
});

test("生成器本身不再往正文写道歉句（治本，而不是只靠事后检查）", async () => {
  const src = await readFile(new URL("../scripts/digest-fetch.ts", import.meta.url), "utf8");
  // 只允许在注释里提到这句话（解释历史），不允许出现在返回值里
  const code = src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.doesNotMatch(code, /LLM 摘要失败/, "占位符文案又回到生成器的返回值里了");
  assert.doesNotMatch(code, /请手动补充/);
  assert.doesNotMatch(code, /自动摘要失败，下面是原文节选/);
  assert.match(src, /return \{ ok: false, text: "" \}/, "摘要失败应该返回空字符串，正文里就不出现这段");
});

test("门禁里有这个检查", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.scripts["check:digest-quality"], "缺少 check:digest-quality 脚本");
  assert.match(pkg.scripts.gate, /check:digest-quality/, "门禁没跑占位符检查");
});

test("英文版道歉句也要被认出来（第 120 轮：38 个 .en.mdx 带着它而门禁是绿的）", async () => {
  const { placeholdersIn } = await import("../scripts/check-digest-placeholders.mjs");
  const cases = [
    "(LLM summarization failed, please manually add it later)",
    "(LLM summary failed, please supplement manually later)",
    "(LLM summary generation failed, please add the summary manually later)",
    "(LLM summarization failed, please supplement it manually later)",
  ];
  for (const text of cases) {
    assert.ok(placeholdersIn(text).length > 0, `没认出英文占位符：${text}`);
  }
  // 正常的英文摘要不该误伤
  assert.deepEqual(placeholdersIn("A paper about training environments for agents."), []);
});
