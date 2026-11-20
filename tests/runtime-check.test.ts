import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCRIPT = new URL("../scripts/check-runtime.mjs", import.meta.url);

test("运行时自检要能区分「页面报错」和「环境不可用」", async () => {
  const src = await readFile(SCRIPT, "utf8");
  // exit 1 = 真问题；exit 2 = dist 没构建 / 浏览器不可用（CI 里降级为 warning）
  assert.match(src, /process\.exit\(1\)/, "真问题必须 exit 1");
  assert.match(src, /process\.exit\(2\)/, "环境问题必须 exit 2");
});

test("本地静态服务器上 /api/* 必然 404，不能当成页面缺陷", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /rel\.startsWith\("\/api\/"\)/);
});

test("必须监听 pageerror 和 console error 两类错误", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /page\.on\("pageerror"/);
  assert.match(src, /page\.on\("console"/);
  assert.match(src, /page\.on\("response"/);
});

test("deploy 工作流里要跑这一步，且 exit 2 时降级而不是卡发布", async () => {
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(wf, /npm run check:runtime/);
  assert.ok(wf.includes('"$code" -eq 2'), "exit 2 必须单独处理（降级为 warning）");
});

test("标签页路径必须动态发现：写死 /tag/ai/ 这种 slug 会静默失效", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /async function firstTagPath\(lang\)/);
  assert.match(src, /await readdir\(dir/, "要从 dist 里读真实目录");
  // 目标页不存在时必须有显式警告，不能悄悄少检查几页还报「通过」
  assert.match(src, /跳过 \$\{missing\.length\} 个不存在的目标页/);
});

