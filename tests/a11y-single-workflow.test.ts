/**
 * 两条 a11y 流水线合成一条（第 99 轮）。
 *
 * 合并前：`a11y.yml`（本地 dist 全站 1188 页 × 两主题）与 `a11y-audit.yml`
 * （打线上 24 模板 × 两主题 × 两视口 + 水合）。名字几乎一样、artifact 同名、覆盖重叠；
 * 线上那条还依赖生产可用 —— 出问题时分不清是代码坏了还是站点连不上。
 *
 * 这条测试把「只剩一条、且只测本地 dist」钉住，防止有人再手滑加回一条。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const DIR = new URL("../.github/workflows/", import.meta.url);
const files = await readdir(DIR);
const source = await readFile(new URL("a11y.yml", DIR), "utf8");

test("只允许一条 a11y 流水线", () => {
  const a11y = files.filter((f) => /^a11y.*\.yml$/.test(f));
  assert.deepEqual(a11y, ["a11y.yml"], `还有重复的 a11y 流水线：${a11y.join(" / ")}`);
});

test("它测的是本地构建，不打线上", () => {
  assert.match(source, /npm run build/, "没有构建就没有确定的被测产物");
  assert.doesNotMatch(source, /https:\/\/www\.zorotreeking\.online/, "不该直接打线上");
  assert.doesNotMatch(source, /BASE_URL:\s*https?:/, "不该用 BASE_URL 指向远端");
});

test("三类覆盖面都在：全站两主题、窄屏抽查、岛水合", () => {
  assert.match(source, /a11y-audit\.mjs --all --scheme both/);
  assert.match(source, /--viewport 390x844/);
  assert.match(source, /check-hydration\.mjs/);
});

test("artifact 名字在本仓库内唯一（合并前两条都叫 a11y-report）", async () => {
  const names = new Map<string, string[]>();
  for (const file of files) {
    const text = await readFile(new URL(file, DIR), "utf8");
    for (const match of text.matchAll(/name:\s*(a11y-report[\w-]*)/g)) {
      names.set(match[1], [...(names.get(match[1]) ?? []), file]);
    }
  }
  for (const [name, owners] of names) {
    assert.equal(owners.length, 1, `artifact/步骤名 ${name} 在 ${owners.join(" 与 ")} 里重复了`);
  }
});
