/**
 * 本地门禁必须覆盖 CI 会用到的运行时检查（第 143 轮）。
 *
 * 真实事故：`check:interactions` 只在 `deploy.yml` 里跑，本地 `npm run gate` 不含它。
 * 第 143 轮把主题按钮的 aria-label 本地化后，本地全绿、推送后 CI 红在
 * 「Interaction smoke」→ 部署被回滚，生产停在上一版 17 分钟才发现。
 *
 * 这条不是"把所有 CI 步骤搬进本地"（那样门禁要跑半小时），而是钉住那些
 * **只在 CI 里跑、坏了会让部署回滚**的交互类检查。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("本地门禁包含交互自检与双主题可访问性快检", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const gate: string = pkg.scripts.gate;
  assert.match(gate, /check:interactions/, "交互自检不在门禁里，推送后才发现就晚了（会回滚部署）");
  assert.match(gate, /check:a11y:fast/);
  // 顺序：必须在 build 之后（这些检查读 dist）
  assert.ok(gate.indexOf("npm run build") < gate.indexOf("check:interactions"), "必须先 build 再跑交互自检");
});

test("本地门禁包含运行时自检，且参数与 CI 一致", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const gate: string = pkg.scripts.gate;
  assert.match(gate, /check:runtime/, "运行时自检（JS 报错/控制台错误/CLS）不在门禁里");
  // CI 用 --cls=0.12 --lcp=8000（runner 环境噪声大）；本地必须同一口径，
  // 否则本地 0.1 绿、CI 0.12 红的情况又会出现
  assert.match(gate, /--cls=0\.12/);
  assert.match(gate, /--lcp=8000/);
});

test("deploy.yml 的运行命令都能在 package.json 里找到", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const workflow = await read(".github/workflows/deploy.yml");
  const commands = [...workflow.matchAll(/npm run ([a-z0-9:.-]+)([^\n>]*)/g)]
    .map((m) => `${m[1]}${m[2]}`)
    .filter((cmd) => !cmd.includes("--context")); // report-ci-status 不是检查项
  const names = commands.map((cmd) => cmd.split(/\s+/)[0]);
  for (const name of new Set(names)) {
    assert.ok(pkg.scripts[name], `deploy.yml 用到了 package.json 里不存在的脚本：npm run ${name}`);
  }
});

test("deploy.yml 里的交互烟测步骤确实存在（两边对得上）", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(workflow, /Interaction smoke/);
  assert.match(workflow, /npm run check:interactions/);
});

test("交互自检里的选择器不能绑在会翻译的文案上", async () => {
  const script = await read("scripts/check-interactions.mjs");
  const themeScenario = script.slice(script.indexOf("深色模式切换"), script.indexOf("async function main"));
  assert.match(themeScenario, /#theme-toggle/, "主题按钮要用稳定 id 选择");
  assert.doesNotMatch(themeScenario, /aria-label="toggle theme"/, "绑英文字面量，本地化后必红");
});
