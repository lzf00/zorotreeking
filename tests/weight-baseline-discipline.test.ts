/**
 * 基线不能被一条命令悄悄放宽（第 151 轮）。
 *
 * 事故：`/invest/digest/` 越过 220 KB 预算，我跑 `--update-baseline` 想登记它，
 * 结果那条命令把**所有**漂移页面一起重新登记了 —— `/changelog/` 从 336 KB
 * 涨到 353 KB 也被写成"基线"，闸门等于被无声关掉一半。
 *
 * 现在：`--update-baseline` 只登记新页面；既有页面要显式 `--rebless=/path/`。
 * 那份点名清单本身就是"我知道它变重了"的记录。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("既有页面要显式点名才能重登记", async () => {
  const script = await read("scripts/check-page-weight.mjs");
  assert.match(script, /--rebless=/, "缺少显式重登记的开关");
  assert.match(script, /if \(known && !rebless\.includes\(page\.path\)\)/, "既有页面默认必须保持原基线值");
});

test("基线文件里每一项都写明了理由", async () => {
  const raw = await read("scripts/page-weight-baseline.json");
  const baseline = JSON.parse(raw) as Record<string, { reason?: string }>;
  const missing = Object.entries(baseline)
    .filter(([, value]) => !value.reason || value.reason.trim().length < 8)
    .map(([path]) => path);
  assert.deepEqual(missing, [], `这些基线没有说明为什么超标：${missing.join(", ")}`);
});

test("日报索引页是靠分页瘦下来的，不是靠再挂一条基线", async () => {
  const raw = await read("scripts/page-weight-baseline.json");
  const baseline = JSON.parse(raw) as Record<string, { reason: string }>;
  // 第 189 轮：四个归档页按 48 期分页，首页 226–232 KB → 153–155 KB，已跌回预算内，
  // `--update-baseline` 会自动把它们移出基线（白名单只增不减等于闸门失效）。
  for (const path of ["/ai/digest/", "/en/ai/digest/", "/invest/digest/", "/en/invest/digest/"]) {
    assert.equal(baseline[path], undefined, `${path} 已分页瘦身，不该还挂在基线里`);
  }
  // 而且这个改造要留下记录，下一个人才知道"为什么它不在基线里"
  const debt = await read("docs/known-debt.md");
  assert.match(debt, /第 189 轮[\s\S]{0,400}分页/, "分页这件事要写进 known-debt");
});
