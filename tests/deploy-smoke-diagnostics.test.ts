/**
 * 部署烟测的失败诊断不能是死代码（第 92 轮）。
 *
 * 现象：`Build & Deploy` 连续三挂在「Interaction smoke」，而 GitHub 的注解里只有一句
 * 「Process completed with exit code 1」——场景名、报错原因一个字都没有，日志接口
 * 又是 403，等于完全瞎跑。
 *
 * 原因：GitHub Actions 的 `run:` 默认 shell 是 `bash -eo pipefail`。写
 *
 *     npm run check:interactions > /tmp/interactions.log 2>&1
 *     code=$?
 *     cat /tmp/interactions.log          # ← 永远执行不到
 *
 * 命令一旦失败，shell 立刻退出，后面「把日志打出来」的整段全是死代码。
 * 必须在这些步骤里先 `set +e`（或改用 `if ! …; then`）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const parsed = parse(deploy);
const steps = parsed.jobs["build-and-deploy"].steps;

/** 把所有 workflow 里「跑命令 → 看 $?」的步骤都收进来：它们在 bash -e 下都必须自己 set +e。 */
const allWorkflows = ["a11y.yml", "a11y-audit.yml", "daily-digest.yml", "deadlink-check.yml", "deploy.yml", "lighthouse.yml", "lighthouse-mobile.yml", "site-audit.yml"];
const captureSteps = [];
for (const name of allWorkflows) {
  const source = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
  for (const [jobName, job] of Object.entries(parse(source).jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === "string" && step.run.includes("code=$?")) captureSteps.push({ ...step, workflow: name, job: jobName });
    }
  }
}

test("每个读 $? 的步骤都先关了 -e，否则日志与注解是死代码", () => {
  assert.ok(captureSteps.length >= 4, `只找到 ${captureSteps.length} 个读 $? 的步骤，测试本身可能失效了`);
  const broken = captureSteps.filter((step) => !/(^|\n)\s*set \+e\b/.test(step.run));
  assert.deepEqual(
    broken.map((step) => `${step.workflow} / ${step.name}`),
    [],
    "这些步骤在失败时不会打印日志/注解",
  );
});

test("烟测失败时会把日志尾部打出来（脚本可能在打 ✗ 之前就抛错）", () => {
  const smoke = steps.find((step) => step.name.startsWith("Interaction smoke"));
  assert.ok(smoke, "找不到交互烟测步骤");
  assert.match(smoke.run, /tail -\d+ \/tmp\/interactions\.log/, "失败时没兜底打印日志尾部");
  assert.match(smoke.run, /exit "\$code"/, "步骤必须把真实退出码传出去，别自己吞掉失败");
});
