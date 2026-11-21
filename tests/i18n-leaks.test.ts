/**
 * 英文页里的中文残留（第 121 轮）。
 *
 * 线上 `/en/invest/market-recap-2026-11-13/` 正文整段是中文引用 —— 翻译链路只翻了标题和表格。
 * 现在页面会声明"这是机翻，下面保留原文"，并且新增残留会被审计脚本拦下来。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { cjkCount, cjkLeaks, untranslatedNotice } from "../src/lib/i18n-leaks";
import { bodyOf, leaksInBody } from "../scripts/check-i18n-leaks.mjs";

const ZH_PARAGRAPH = "微软正加紧修复故障、恢复各项服务。此次全球性宕机事件扰乱了众多企业与政府机构的运转。";

test("整段中文引用会被数出来，并触发提示", () => {
  const body = `## Title\n\nText in English.\n\n> ${ZH_PARAGRAPH}\n`;
  const leaks = cjkLeaks(body);
  assert.equal(leaks.quotes, 1);
  assert.equal(leaks.readerFacing, true);
  const notice = untranslatedNotice(leaks);
  assert.match(notice!, /machine-translated/);
  assert.match(notice!, /quoted source excerpt/);
});

test("正常英文页面不出提示（358 页里绝大多数是干净的）", () => {
  const body = `## Title\n\nA normal summary about training environments.\n`;
  const leaks = cjkLeaks(body);
  assert.equal(leaks.readerFacing, false);
  assert.equal(untranslatedNotice(leaks), null);
});

test("短中文（专名、引用中文版链接）不算读者读不懂的整段", () => {
  const leaks = cjkLeaks(`见中文版 / see 中文版 page\n`);
  assert.equal(leaks.readerFacing, false);
  assert.equal(cjkCount("中文"), 2);
});

test("中文标题单独归类：是原始标题，不触发机翻提示", () => {
  const leaks = cjkLeaks(`## ${ZH_PARAGRAPH}\n\nEnglish body.\n`);
  assert.equal(leaks.headings, 1);
  assert.equal(leaks.readerFacing, false);
});

test("审计脚本的正文提取与判定口径和页面一致", async () => {
  const raw = await readFile(new URL("../src/content/invest/market-recap-2026-11-13.en.mdx", import.meta.url), "utf8");
  const body = bodyOf(raw);
  const scriptLeaks = leaksInBody(body);
  const libLeaks = cjkLeaks(body);
  assert.equal(scriptLeaks.prose, libLeaks.prose);
  assert.equal(scriptLeaks.quotes, libLeaks.quotes);
  assert.ok(scriptLeaks.total > 0, "这一期确实有中文残留（已知欠账）");
});

test("baseline 存在且是「文件 → 处数」的映射", async () => {
  const baseline = JSON.parse(await readFile(new URL("../scripts/i18n-leaks-baseline.json", import.meta.url), "utf8"));
  const entries = Object.entries(baseline);
  assert.ok(entries.length > 0, "baseline 不应为空");
  for (const [file, count] of entries) {
    assert.match(String(file), /^(ai|invest)\/.+\.en\.mdx$/, `baseline 里有非法路径：${file}`);
    assert.equal(typeof count, "number");
    assert.ok((count as number) > 0);
  }
});
