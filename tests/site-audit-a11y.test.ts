/**
 * 每周巡检里的 a11y 抽样步骤必须能真的跑起来（第 125 轮）。
 *
 * 第 124 轮我把 `--sample` 接进 `site-audit.yml` 时写的是 `npm run check:a11y:sample`，
 * 而那个脚本带 `--dist` —— 但 site-audit **从不构建 dist**（它查的就是线上那份）。
 * 结果这条步骤会在第一次运行时以「读不到 sitemap」退出 2，而且只有下周四才会发现。
 *
 * 这里盯住的正是这种"加了永远不会通过的步骤"的错。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const WORKFLOW = new URL("../.github/workflows/site-audit.yml", import.meta.url);

async function step(): Promise<string> {
  const yml = await readFile(WORKFLOW, "utf8");
  const start = yml.indexOf("- name: a11y sample from sitemap");
  assert.ok(start !== -1, "site-audit 里没有 a11y 抽样步骤了");
  const rest = yml.slice(start);
  return rest.slice(0, rest.indexOf("\n      - name:", 1) === -1 ? undefined : rest.indexOf("\n      - name:", 1));
}

test("抽样步骤不许依赖 dist（巡检不构建）", async () => {
  const body = await step();
  assert.doesNotMatch(body, /--dist\b/, "步骤用了 --dist，但巡检不构建 dist，会因缺 sitemap 退出 2");
  assert.match(body, /--sitemap=/, "应当复用上面抓下来的线上 sitemap");
});

test("抽样步骤的 seed 按 ISO 周变化（下周换一批页）", async () => {
  const body = await step();
  assert.match(body, /%G-W%V/, "seed 要取 ISO 周，否则每周都抽同一批页");
});

test("巡检确实没构建 dist，所以上面的断言才有意义", async () => {
  const yml = await readFile(WORKFLOW, "utf8");
  assert.doesNotMatch(yml, /npm run build/, "如果将来巡检开始构建 dist，这条测试的前提要重写");
});

test("--dry-run 能只抽样不加载页面（本地/CI 秒验）", async () => {
  const script = await readFile(new URL("../scripts/check-a11y.mjs", import.meta.url), "utf8");
  assert.match(script, /--dry-run/);
});
