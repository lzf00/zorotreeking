/**
 * 让"runner 上兜底字体是谁"可以测（第 149 轮）。
 *
 * 为什么需要：弱网 CLS 0.223 的位移形态是「整页上移 24px」= 上方某块变矮了，
 * 最可能是兜底字体比网页字体宽、换行多一行，字体到货后变窄。可本机（macOS）
 * 永远落到 Arial / Menlo，量不出来 —— 缺的是"CI 那台机器上有哪些字体"这个事实。
 *
 * 这个脚本不做判断，只测量；门禁只保证它能跑通、且不会因为"字体没装"给出假数字。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("报告脚本存在，且两种输出模式都在", async () => {
  const script = await read("scripts/report-font-env.mjs");
  assert.match(script, /--json/, "要能在 CI 里输出一行 JSON");
  assert.match(script, /Liberation Sans/, "候选里必须有 Linux 上的常见兜底");
  assert.match(script, /DejaVu Sans/, "候选里必须有 DejaVu（Linux 默认无衬线）");
  assert.match(script, /DejaVu Sans Mono/, "等宽也要测");
});

test("没装的字体不给假比例（canvas 会落到默认字体）", async () => {
  const script = await read("scripts/report-font-env.mjs");
  assert.match(script, /ratio: ok \?/, "未安装的候选必须输出 null，否则数字是默认字体的比例");
  assert.match(script, /installed\(family\)/, "要有安装判定");
});

test("deploy 会跑这个报告，并把它发成 notice", async () => {
  const wf = await read(".github/workflows/deploy.yml");
  assert.match(wf, /node scripts\/report-font-env\.mjs --json/, "deploy 要量一次字体环境");
  assert.match(wf, /::notice::字体环境/, "结果要进注解（日志接口读不到）");
  // 纯诊断步骤不许把部署顶红
  const block = wf.slice(wf.indexOf("id: font-env"), wf.indexOf("id: perf-mobile"));
  assert.match(block, /continue-on-error: true/);
  assert.match(block, /set \+e/);
});
