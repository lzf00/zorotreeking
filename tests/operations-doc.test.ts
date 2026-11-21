/**
 * 运维速查页不能变成过时的谎言（第 100 轮）。
 *
 * `docs/architecture.md` 记的是历史（为什么这么改），`docs/operations.md` 记的是**当前状态**
 * （现在什么在跑、红了看哪、哪些要人拍板）。文档最容易的死法是「代码改了，文档没改」，
 * 于是新接手的人照着过时的表去排查，比没有文档更糟。
 *
 * 这里把「文档 vs 仓库真实结构」钉住：漏一个工作流、漏一个门禁步骤、少一个 cron，都会红。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const doc = await readFile(new URL("docs/operations.md", root), "utf8");
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const workflowFiles = (await readdir(new URL(".github/workflows/", root))).filter((f) => f.endsWith(".yml"));
const names = await Promise.all(
  workflowFiles.map(async (f) => parse(await readFile(new URL(`.github/workflows/${f}`, root), "utf8")).name),
);

test("每个工作流都在速查页里有一行（漏一个就少一处排查入口）", () => {
  for (const name of names) {
    assert.ok(doc.includes(name), `docs/operations.md 没提到工作流「${name}」`);
  }
  // 反向：文档里不该出现已删除的工作流
  assert.doesNotMatch(doc, /a11y-audit\.yml/, "文档还在提已经删掉的 a11y-audit.yml");
});

test("门禁的每一步都在速查页的表格里", () => {
  const steps = pkg.scripts.gate.split(/ && /).map((s: string) => s.replace(/^npm run /, "").trim());
  for (const step of steps) {
    assert.ok(doc.includes(`\`${step}\``), `docs/operations.md 没解释门禁步骤「${step}」`);
  }
  assert.ok(doc.includes("不在门禁里"), "没列出「故意不进门诊禁」的检查，容易被当成遗漏");
});

test("时间表与实际 cron 对不上就红（防止改完 cron 忘了改文档）", async () => {
  const digest = parse(await readFile(new URL(".github/workflows/daily-digest.yml", root), "utf8"));
  const cron = digest.on.schedule[0].cron;
  const [minute, hour] = cron.split(" ").map(Number);
  const bjt = `${String((hour + 8) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  assert.ok(doc.includes(bjt), `文档里的「日报 02:17」与真实 cron（${cron} → BJT ${bjt}）不一致`);
  assert.match(doc, /延迟\s*\*?\*?5–7/, "文档必须写明 schedule 会延迟 5–7.5 小时这个事实");
});

test("要人决定的事项清单不是空壳，且已修复的问题单独成节", () => {
  assert.match(doc, /需要人决定的事/);
  for (const topic of ["Node", "nginx", "api/market", "gh", "日报"]) {
    assert.ok(doc.toLowerCase().includes(topic.toLowerCase()), `待办清单漏了「${topic}」`);
  }
  // 修好的问题不能继续挂在"要人决定"里，否则读者会去修一个已经不存在的问题
  const pending = doc.slice(doc.indexOf("需要人决定的事"), doc.indexOf("已修复的历史问题"));
  assert.doesNotMatch(pending, /\/api\/feedback/, "feedback 422 已修复，不该还挂在待办里");
  assert.match(doc, /已修复的历史问题/, "没有「已修复」小节，读者分不清哪些还在等你");
  assert.match(doc, /architecture\.md/, "速查页要能跳回历史记录");
});
