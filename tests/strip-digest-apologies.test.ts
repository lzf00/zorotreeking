/**
 * 删道歉句的脚本（第 115 轮中文、第 120 轮英文）。
 *
 * 只删"单独一行的括号说明"，别碰正文：条目标题、来源、原文链接都必须留着。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { APOLOGY_LINE, stripApologies } from "../scripts/strip-digest-apologies.mjs";

test("中文道歉行被删掉，正文不动", () => {
  const before = `## 标题\n\n*HF ★ 3 · 作者*\n\n（LLM 摘要失败，请稍后手动补充）\n\n<FeedbackButtons slug="x" client:visible />\n`;
  const after = stripApologies(before);
  assert.doesNotMatch(after, /摘要失败/);
  assert.match(after, /## 标题/);
  assert.match(after, /HF ★ 3/);
  assert.match(after, /FeedbackButtons/);
});

test("英文道歉行的十几种拼法都能命中", () => {
  const variants = [
    "(LLM summarization failed, please manually add it later)",
    "(LLM summary failed, please supplement manually later)",
    "(LLM summary generation failed, please add the summary manually later)",
    "(LLM summarization failed, please supplement it manually later)",
    "(LLM summary failed, please add it manually later.)",
  ];
  for (const line of variants) {
    assert.ok(APOLOGY_LINE.test(line), `没命中：${line}`);
  }
});

test("真摘要不会被误删", () => {
  const prose = "本文提出了一种新的训练环境，把长程任务拆成可验证的子目标。";
  const body = `## 标题\n\n*HF ★ 3*\n\n${prose}\n`;
  assert.equal(stripApologies(body), body);
  assert.equal(APOLOGY_LINE.test(prose), false);
  assert.equal(APOLOGY_LINE.test("(括号里只是补充说明)"), false, "普通括号说明不算道歉句");
});

test("幂等：删过再跑不会继续改", () => {
  const once = stripApologies(`## 标题\n\n（摘要为空，请手动补充）\n\ntext\n`);
  assert.equal(stripApologies(once), once);
});
