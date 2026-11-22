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

test("日报索引页的重登记理由写清了「结构性方案」而不只是「它超了」", async () => {
  const raw = await read("scripts/page-weight-baseline.json");
  const entry = (JSON.parse(raw) as Record<string, { reason: string }>)["/invest/digest/"];
  assert.ok(entry, "该页应当已登记");
  assert.match(entry.reason, /按日增长|分页|最近 N 期/, "理由要指向结构原因和方案，否则下一个人只会再加一条基线");
});
