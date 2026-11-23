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
  // 第 185 轮起英文日报的中文残留已清零（baseline 变成空文件），所以这里用构造的正文
  // 对照两套实现的判定口径 —— 原来拿一期"确实有残留"的真实日报当样本，清零后那条
  // 断言就自相矛盾了。
  const raw = await readFile(new URL("../src/content/invest/market-recap-2026-11-13.en.mdx", import.meta.url), "utf8");
  const real = leaksInBody(bodyOf(raw));
  const libReal = cjkLeaks(bodyOf(raw));
  assert.equal(real.prose, libReal.prose, "真实文件的正文判定也要一致");
  assert.equal(real.quotes, libReal.quotes, "真实文件的引用判定也要一致");

  const body = `${"中文".repeat(10)}\n\n> ${"引用".repeat(10)}\n\nshort 中文\n`;
  const scriptLeaks = leaksInBody(body);
  const libLeaks = cjkLeaks(body);
  assert.equal(scriptLeaks.prose, libLeaks.prose);
  assert.equal(scriptLeaks.quotes, libLeaks.quotes);
  assert.ok(scriptLeaks.total > 0, "构造的样本必须被判为残留，否则这条测试没意义");
});

test("baseline 存在且是「文件 → 处数」的映射", async () => {
  const baseline = JSON.parse(await readFile(new URL("../scripts/i18n-leaks-baseline.json", import.meta.url), "utf8"));
  const entries = Object.entries(baseline);
  // 空 baseline 是**目标状态**（第 185 轮清零），不是错误；非空时每条都要合法。
  if (!entries.length) {
    const text = await readFile(new URL("../scripts/i18n-leaks-baseline.json", import.meta.url), "utf8");
    assert.equal(text.trim(), "{}", "空基线就写 {}，不要留注释和空行");
  }
  for (const [file, count] of entries) {
    assert.match(String(file), /^(ai|invest)\/.+\.en\.mdx$/, `baseline 里有非法路径：${file}`);
    assert.equal(typeof count, "number");
    assert.ok((count as number) > 0);
  }
});
