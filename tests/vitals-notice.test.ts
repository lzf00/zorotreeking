/**
 * 弱网首屏的 CLS 必须"能定位"，不能只留一个数字（第 148 轮）。
 *
 * 背景：CI 的弱网基线（只记录、不挡发布）连续几次报
 * `CLS 最差 0.223（/invest/market/）`，而本机同参数（390×844、1.6 Mbps、CPU 4×）
 * 量出来是 **0**，连"字体晚到 / 图片晚到 / 接口慢"三种模拟也都是 0。
 * 也就是说这个数字是真的（CI 上稳定复现），但**我看不见它抖动的是哪个元素**：
 *   · Actions 日志接口是 403（没有管理员权限），读不到逐页明细；
 *   · 中位数聚合只保留数字，把 shifts 详情丢了。
 *
 * 所以两处改动：
 *   1. 中位数行保留"CLS 最大那一轮"的 shifts（详情才有排障价值）；
 *   2. CLS 超过 Core Web Vitals good 线 0.1 时发 `::notice::` —— annotation 是这台
 *      机器上唯一能读到的通道。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("中位数聚合保留位移来源（取最差那一轮）", async () => {
  const script = await read("scripts/check-runtime.mjs");
  const block = script.slice(script.indexOf("for (const [url, rows] of byUrl)"), script.indexOf("for (const row of medians)"));
  assert.match(block, /worstRun/, "没有取 CLS 最大的那一轮");
  assert.match(block, /shifts: worstRun\?\.shifts \?\? \[\]/, "中位数行没有带上 shifts");
});

test("CLS 超过 0.1 但没超预算时发 notice（带元素）", async () => {
  const script = await read("scripts/check-runtime.mjs");
  assert.match(script, /::notice title=CLS/, "没有 notice 就没法从 annotations 里定位");
  const block = script.slice(script.indexOf("if (row.cls > 0.1 && row.cls <= CLS_BUDGET)"));
  assert.match(block.slice(0, 400), /row\.url/);
  assert.match(block.slice(0, 400), /row\.shifts/);
});

test("notice 只在「不挡发布」的区间发，超预算仍然照常判失败", async () => {
  const script = await read("scripts/check-runtime.mjs");
  const notice = script.indexOf("if (row.cls > 0.1 && row.cls <= CLS_BUDGET)");
  const fail = script.indexOf("if (row.cls > CLS_BUDGET)");
  assert.ok(notice > 0 && fail > 0);
  // 判失败的逻辑没被 notice 顶掉
  assert.match(script.slice(fail, fail + 300), /problems\.push|softVitals\.push/);
});
