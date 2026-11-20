import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { proseFingerprint, sameProse } from "../scripts/lib/prose-fingerprint.mjs";

const SCRIPT = new URL("../scripts/check-content-dates.mjs", import.meta.url);

test("只改外链/标签的提交，正文指纹不变（不该要求更新 updated）", () => {
  const before = `---\ndate: 2026-10-26\n---\n\n## <a href="http://x.com/a" target="_blank">标题</a>\n\n*2026/10/26 11:39:00*\n`;
  const after = `---\ndate: 2026-10-26\n---\n\n## 标题\n\n*2026/10/26 11:39:00*\n`;
  assert.ok(sameProse(before, after), "去外链是机械修复，指纹应相同");
});

test("写坏的 JSX 行修好不算内容变化", () => {
  const broken = `---\ndate: 2026-06-10\n---\n\n正文段落。\n\n<FeedbackButtons slug="item:x" client:visiblevisible}}\n\n# 标题\n`;
  const fixed = `---\ndate: 2026-06-10\n---\n\n正文段落。\n\n<FeedbackButtons slug="item:x" client:visible />\n\n# 标题\n`;
  assert.ok(sameProse(broken, fixed), "修 JSX 语法不应改变指纹");
});

test("正文真的改了，指纹必须变", () => {
  const before = "---\ndate: 2026-06-10\n---\n\n沪指涨 1.2%，成交额 8000 亿。\n";
  const after = "---\ndate: 2026-06-10\n---\n\n沪指涨 1.2%，成交额 8100 亿。\n";
  assert.notEqual(proseFingerprint(before), proseFingerprint(after));
});

test("frontmatter 里的日期/标题改动不算正文变化", () => {
  const a = "---\ndate: 2026-06-10\ntitle: 甲\n---\n\n正文。\n";
  const b = "---\ndate: 2026-07-01\ntitle: 乙\n---\n\n正文。\n";
  assert.ok(sameProse(a, b));
});

test("检查脚本要保守：批量提交与机械修复都不算「忘了更新」", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /fileCount > 5/, "批量重构（>5 文件）要排除");
  assert.match(src, /isMechanicalEdit\(commit\.sha, file, text\)/, "要按正文指纹排除机械修复");
  assert.match(src, /--strict/, "需要能作为硬门禁使用");
  // 曾经因为入口忘了存 sha，git show 失败被 catch 吞掉、判定整段失效
  assert.match(src, /sha: current\.sha/, "history 必须存 sha");
  assert.match(src, /history 条目缺 sha/, "缺 sha 必须显式报错而不是静默降级");
});
