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

test("手机视口必须是独立一档：窄屏的重排问题宽屏看不见", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /--mobile/);
  assert.match(src, /MOBILE \? "390x844" : "1280x900"/, "--mobile 默认要用手机尺寸");
  assert.match(src, /function mobileTargets\(/, "移动端只抽查关键模板");
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.ok(wf.includes("npm run check:runtime -- --mobile"), "deploy 要跑移动端一遍");
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

test("核心指标：CLS 卡 0.1、LCP 只拦明显异常", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /const CLS_BUDGET = Number\(valueOf\("cls", "0\.1"\)\)/, "CLS 预算默认 0.1");
  assert.match(src, /vitals\.cls > CLS_BUDGET/, "CLS 超预算要判失败");
  assert.match(src, /const LCP_LIMIT = Number\(valueOf\("lcp", "6000"\)\)/, "LCP 阈值要宽松（本地/CI 机器差异大）");
  assert.match(src, /vitals\.lcp > LCP_LIMIT/, "LCP 超阈值才判失败");
  assert.match(src, /全新 browser 的第一次导航要付冷启动成本/, "要先预热再量 LCP");
  // CI 日志接口 403，只能靠 annotations 读失败原因
  const wf2 = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.ok(wf2.includes("::error::运行时自检失败"), "失败时要写进 annotations");
  // 位移必须能归因，否则报「CLS 0.066」没人知道该改哪里
  assert.match(src, /entry\.sources/, "要采集 layout-shift 的 source 元素");
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.ok(wf.includes("npm run check:runtime -- --vitals --cls=0.25"), "deploy 要带 --vitals，且 CI 的 CLS 预算放宽");
  assert.match(src, /valueOf\("cls", "0\.1"\)/, "CLS 预算要可配");
});

