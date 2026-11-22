/**
 * GitHub 的 workflow 解析器比 YAML 1.2 严（第 180 轮实测）。
 *
 * 事故：`if: steps.due.outputs.due == 'true`（少一个右引号）在本地是**合法 YAML** ——
 * `'` 出现在标量中间只是普通字符。GitHub 直接判：
 *
 *   Invalid workflow file: .github/workflows/a11y.yml#L1
 *   (Line: 72, Col: 13): Unexpected symbol: ''true'
 *
 * 整条 workflow 启动即失败：event=push、<1 秒、零 job、check-runs 查不到任何痕迹。
 * 所以要有两道网：一道在本地（引号配对），一道问 GitHub 自己（名字退化成路径）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { auditWorkflowRegistration } from "../scripts/check-automation-health.mjs";
import { auditQuotePairs } from "../scripts/check-workflows.mjs";

const DIR = new URL("../.github/workflows/", import.meta.url);
const files = () => readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

test("单引号不配对的 if: 会被抓出来", () => {
  const problems = auditQuotePairs([
    { file: "bad.yml", text: "      - run: x\n        if: steps.due.outputs.due == 'true\n" },
    { file: "also-bad.yml", text: "    if: github.event_name == 'push\n    runs-on: ubuntu-latest\n" },
  ]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /bad\.yml:2.*单引号不配对/);
});

test("成对的引号、块标量都不误报", () => {
  assert.deepEqual(
    auditQuotePairs([
      { file: "ok.yml", text: "        if: steps.due.outputs.due == 'true'\n" },
      { file: "fn.yml", text: "        if: contains(github.event.head_commit.message, '[skip ci]')\n" },
      { file: "block.yml", text: "        if: |\n          echo 'unbalanced\n" },
      { file: "none.yml", text: "        if: always()\n" },
    ]),
    [],
  );
});

test("仓库里每条 workflow 的 if: 都是配对的（回归）", () => {
  const problems = auditQuotePairs(files().map((file) => ({ file, text: readFileSync(new URL(file, DIR), "utf8") })));
  assert.deepEqual(problems, []);
});

test("GitHub 解析不了时，名字会退化成文件路径 —— 那是个必须报的问题", () => {
  assert.equal(
    auditWorkflowRegistration([
      { name: ".github/workflows/a11y.yml", path: ".github/workflows/a11y.yml" },
      { name: "Build & Deploy", path: ".github/workflows/deploy.yml" },
    ]).length,
    1,
  );
  assert.deepEqual(auditWorkflowRegistration([{ name: "Build & Deploy", path: ".github/workflows/deploy.yml" }]), []);
});

test("a11y.yml 是 workflow_run 触发（不再靠 cron），并且带判旧闸", async () => {
  const yml = await readFile(new URL("a11y.yml", DIR), "utf8");
  assert.match(yml, /workflow_run:/);
  assert.match(yml, /steps\.due\.outputs\.due == 'true'/, "修复后的引号必须是配对的版本");
});
