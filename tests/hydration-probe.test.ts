/**
 * 岛水合巡检的两个关键点（第 84 轮）：
 *
 * 1. 判定要用 `ssr` 属性（Astro 水合成功后摘掉它），而不是「有没有控制台报错」。
 *    旧巡检只统计岛的个数和 console error，所以**从未真正验证水合**：
 *    本站 36 个岛几乎都是 `client:visible`，不滚到附近就不水合，坏了也没有任何报错（假阴性）。
 *
 * 2. 滚动脚本必须是「立即调用的异步函数」。`page.evaluate(字符串)` 只对表达式求值，
 *    传 `async () => {...}` 只会得到一个函数对象、不会被调用 —— 滚动静默失效，
 *    表现为「只有首屏的岛水合了」。这一条是实测踩到的（修之前 3 个岛永远不水合）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyIslands,
  describeUnhydrated,
  fullScrollScript,
  waitForHydration,
} from "../scripts/lib/hydration-probe.mjs";

test("按 ssr 属性区分已水合 / 未水合", () => {
  const islands = [
    { uid: "1", component: "/_astro/MarketIndicesGrid.abc.js", hasSsr: false },
    { uid: "2", component: "/_astro/AliRouteMap.def.js", hasSsr: true },
  ];
  const health = classifyIslands(islands);
  assert.equal(health.ok, false);
  assert.equal(health.hydrated.length, 1);
  assert.deepEqual(health.unhydrated.map((i) => i.uid), ["2"]);

  const clean = classifyIslands([{ uid: "1", hasSsr: false }]);
  assert.equal(clean.ok, true);
  assert.equal(clean.unhydrated.length, 0);
});

test("未水合报告要指出组件名，而不是一串哈希路径", () => {
  const text = describeUnhydrated([
    { component: "/_astro/StockSpotlight.CPT1xbNA.js" },
    { component: "/_astro/SectorRanking.DQUNaNZA.js" },
  ]);
  assert.match(text, /StockSpotlight\.CPT1xbNA\.js/);
  assert.match(text, /^未水合：/);
  assert.ok(!text.includes("/_astro/"), `不该把整条路径塞进报告：${text}`);

  const many = describeUnhydrated(Array.from({ length: 7 }, (_, i) => ({ component: `/x/C${i}.js` })), 2);
  assert.match(many, /等 7 个/);
});

test("滚动脚本必须是 IIFE —— page.evaluate(字符串) 不会调用裸箭头函数", () => {
  const source = fullScrollScript(500);
  assert.ok(source.trimStart().startsWith("(async () => {"), `要以调用表达式开头：${source.slice(0, 30)}`);
  assert.ok(source.trimEnd().endsWith("})()"), "要以 })() 结尾，否则滚动永远不会发生");
  assert.match(source, /const step = 500/);
  // 分步滚 + 兜底滚到底 + 回顶部
  assert.match(source, /for \(let y = 0; y <= height\(\); y \+= step\)/);
  assert.match(source, /window\.scrollTo\(0, height\(\)\)/);
  assert.match(source, /window\.scrollTo\(0, 0\)/);
});

test("轮询把「慢」和「坏」分开：晚一点水合不算失败，永不水合才算", async () => {
  // 第 2 次轮询才水合的假页面
  let reads = 0;
  const slowPage = {
    waitForTimeout: async () => {},
    $$eval: async () => {
      reads++;
      return [{ uid: "1", component: "/a/A.js", hasSsr: reads < 2 }, { uid: "2", component: "/a/B.js", hasSsr: false }];
    },
  };
  const slow = await waitForHydration(slowPage, { timeoutMs: 1_000, pollMs: 0 });
  assert.equal(slow.timeout, false);
  assert.equal(classifyIslands(slow.islands).ok, true);

  // 永远不水合
  const deadPage = {
    waitForTimeout: async () => {},
    $$eval: async () => [{ uid: "9", component: "/a/Map.js", hasSsr: true }],
  };
  const dead = await waitForHydration(deadPage, { timeoutMs: 5, pollMs: 1 });
  assert.equal(dead.timeout, true);
  assert.equal(classifyIslands(dead.islands).ok, false);
});
