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
  assert.match(src, /row\.cls > CLS_BUDGET/, "CLS 超预算要判失败（按每页中位数判）");
  assert.match(src, /const LCP_LIMIT = Number\(valueOf\("lcp", "6000"\)\)/, "LCP 阈值要宽松（本地/CI 机器差异大）");
  assert.match(src, /row\.lcp > LCP_LIMIT/, "LCP 超阈值才判失败（按每页中位数判）");
  assert.match(src, /全新 browser 的第一次导航要付冷启动成本/, "要先预热再量 LCP");
  // CI 日志接口 403，只能靠 annotations 读失败原因
  const wf2 = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.ok(wf2.includes("::error::运行时自检失败"), "失败时要写进 annotations");
  // 位移必须能归因，否则报「CLS 0.066」没人知道该改哪里
  assert.match(src, /entry\.sources/, "要采集 layout-shift 的 source 元素");
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  // 第 70 轮把 Linux 上的 FOUT 抖动静下来（0.103 → 0.017）之后，性能指标重新变成硬门禁，
  // 但预算放宽到 CLS 0.12 / LCP 8s：真实退化会被拦住，runner 抖动不会挡住发布。
  assert.ok(wf.includes("npm run check:runtime -- --vitals --cls=0.12 --lcp=8000"), "CI 用放宽预算的硬门禁");
  assert.ok(!wf.includes("--soft-vitals"), "不再全量 advisory，否则退化没人发现");
  assert.ok(wf.includes("report-ci-status.mjs --context=smoke/runtime"), "失败原因要发成可匿名读取的 commit status");
  assert.match(src, /valueOf\("cls", "0\.1"\)/, "CLS 预算要可配");
  assert.match(src, /SOFT_VITALS/, "要有 advisory 模式");
  assert.match(src, /Emulation\.setCPUThrottlingRate/, "--cpu=N 要能把 CPU 降速，模拟慢设备");
});


test("弱网档：--throttle 用 Lighthouse 同档参数，--repeat 取中位数", async () => {
  const src = await readFile(SCRIPT, "utf8");
  // 无节流时首屏指标是「局域网速度」，量不出真实手机体验（第 73 轮 LCP 问题的根因）
  assert.match(src, /Network\.emulateNetworkConditions/, "要用 CDP 模拟弱网");
  assert.match(src, /1\.6 \* 1024 \* 1024/, "下行按 Lighthouse 默认 1.6 Mbps");
  assert.match(src, /latency: 150/, "RTT 按 Lighthouse 默认 150 ms");
  assert.match(src, /--repeat=/, "要支持多次取中位");
  // 预算判定必须用中位数：单次测量在弱网下会抖，硬卡预算会假红
  assert.match(src, /const mid = \(values\)/, "要按中位数聚合再判预算");
  assert.match(src, /每页取中位数再判预算/);
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["check:perf"], "node scripts/check-runtime.mjs --vitals --mobile --throttle");
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  // 第 148 轮起带 --explain：位移条目要写出 y/h 变化，否则注解里只有"谁在抖"没有"抖多少"
  assert.match(wf, /npm run check:perf -- --explain --limit=6 --repeat=2/, "deploy 要跑一遍弱网基线（带位移详情）");
  assert.match(wf, /::notice::弱网首屏/, "弱网数字要出现在 notice 里");
  assert.match(wf, /仅记录，不影响发布/, "弱网基线不挡发布");
  // 第 74 轮教训：纯记录步骤没加 continue-on-error / set +e，弱网数字把整条部署顶红
  assert.match(wf, /id: perf-mobile\n\s+continue-on-error: true/, "记录步骤必须 continue-on-error");
  assert.match(wf, /set \+e/, "记录步骤要 set +e，否则 bash -e 会先退出");
  assert.match(wf, /perf-mobile=\$\{\{ steps\['perf-mobile'\]\.outcome \}\}/, "诊断清单要包含新步骤，否则失败时是 unknown step");
});
