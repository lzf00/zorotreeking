/**
 * 所有「只显示日期」的地方必须走 `siteDateString`（第 196 轮）。
 *
 * 事故：`site-date.ts` 早就存在，注释甚至写明了「不要用 toISOString().slice(0,10)」，
 * 但全站仍有 **57 处**在用它。这个错误只在**日期带时区**时显形，而 1076 篇内容里只有 4 篇
 * 带（`date: 2026-05-26T00:00:00+08:00` 会被转成 UTC 05-25T16:00），于是：
 *
 *   /photo/hudieren/    （中文）显示 2026-05-26 ✓
 *   /en/photo/hudieren/ （英文）显示 2026-05-25 ✗  ← 同一本相册，两个语言两个日期
 *   /tag/photo/、/en/photo/  也跟着错一天
 *
 * 也就是说：一个「只影响 0.4% 内容」的 bug，被 57 个复制粘贴的调用点放大成了
 * 中英文页面数据不一致 —— 而且它躲过了 check:dates、check:i18n-leaks、所有快照测试。
 *
 * 这道闸门的规则很硬：`src/` 下除了 `site-date.ts` 自己，谁都不许再把 Date 直接切 UTC。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function walk(dir: string, base = "src"): Promise<string[]> {
  const entries = await readdir(new URL(`../${base}/${dir}`, import.meta.url), { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(rel, base)));
    else if (/\.(astro|ts|tsx|mjs)$/.test(entry.name)) out.push(`${base}/${rel}`);
  }
  return out;
}

test("src/ 里不许再出现 toISOString().slice(0, 10)（site-date.ts 自己除外）", async () => {
  const files = await walk("");
  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith("src/lib/site-date.ts")) continue;
    const src = await read(file);
    const hits = src.split("\n").filter((line) => line.includes(".toISOString().slice(0, 10)"));
    for (const line of hits) offenders.push(`${file}: ${line.trim().slice(0, 80)}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `这些地方会把日期整体偏一天（+08 时区）：\n${offenders.join("\n")}\n改用 siteDateString(...)`,
  );
});

test("siteDateString 按站点时区（+08）输出，不受构建机时区影响", async () => {
  const { siteDateString } = await import("../src/lib/site-date.ts");
  // 2026-05-25T16:00Z = 北京 05-26 00:00 —— 这正是那 4 篇内容的解析结果
  assert.equal(siteDateString(new Date("2026-05-25T16:00:00.000Z")), "2026-05-26");
  // 跨年边界同样按 +08 判定
  assert.equal(siteDateString(new Date("2026-12-31T16:00:00.000Z")), "2027-01-01");
  // 当天早些时候（UTC 与 +08 同日）
  assert.equal(siteDateString(new Date("2026-11-26T02:00:00.000Z")), "2026-11-26");
});
