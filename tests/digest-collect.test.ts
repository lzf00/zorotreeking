/**
 * 日报收集链路的失败可见性（scripts/lib/digest-collect.ts + digest-fetch.ts 接线）。
 *
 * 两个真实事故驱动了这些断言：
 *  - 2026-11-19 起 AI 日报静默停更 3 天：0 条也「成功」，workflow 一直是绿的
 *  - 本地无 key 跑一遍：20 条摘要全失败，仍写出占位符文章并退出 0 —— 比停更更糟
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { collectFromSources, diagnosticsReport, starvationReason, summaryHealth } from "../scripts/lib/digest-collect.ts";

const source = (name, items, limit = 5) => ({ name, fetch: async () => items, limit });
const failing = (name, message) => ({ name, fetch: async () => { throw new Error(message); }, limit: 5 });
const paper = (url) => ({ url, title: url, source: "test" });

const DIGEST_FETCH = new URL("../scripts/digest-fetch.ts", import.meta.url);
const DIGEST_WF = new URL("../.github/workflows/daily-digest.yml", import.meta.url);

test("单源失败不拖垮整天：其余源照常收集，失败被记录", async () => {
  const { items, diagnostics } = await collectFromSources([
    source("ok-a", [paper("a1"), paper("a2")]),
    failing("broken", "boom"),
    source("ok-b", [paper("b1")]),
  ]);
  assert.deepEqual(items.map((item) => item.url), ["a1", "a2", "b1"]);
  assert.equal(diagnostics.length, 3);
  assert.equal(diagnostics[1].ok, false);
  assert.match(diagnostics[1].detail, /boom/);
});

test("按 URL 去重，并按每源 limit 截断", async () => {
  const { items, diagnostics } = await collectFromSources([
    source("a", [paper("same"), paper("a2")], 2),
    source("b", [paper("same"), paper("b2")], 2),
  ]);
  assert.deepEqual(items.map((item) => item.url), ["same", "a2", "b2"]);
  assert.equal(diagnostics[1].kept, 2, "kept 记的是截断后保留数");
});

test("全部源失败 → 判定为饥饿，并指出「像是 IP 被挡」", async () => {
  const result = await collectFromSources([failing("x", "403"), failing("y", "timeout")]);
  const reason = starvationReason("ai", result, 3);
  assert.ok(reason, "全挂必须给出叫停理由");
  assert.match(reason, /只收到 0 条/);
  assert.match(reason, /全部源都失败/);
  assert.match(reason, /出口 IP/, "要提示最可能的运维原因");
});

test("只收到一点（少于阈值）也算饥饿，但提示是「部分源失败」", async () => {
  const result = await collectFromSources([source("ok", [paper("only-one")]), failing("bad", "502")]);
  const reason = starvationReason("ai", result, 3);
  assert.ok(reason);
  assert.match(reason, /部分源失败/);
});

test("收到足够条目就不叫停（正常日子不能被误伤）", async () => {
  const result = await collectFromSources([source("ok", [paper("1"), paper("2"), paper("3"), paper("4")])]);
  assert.equal(starvationReason("ai", result, 3), null);
});

test("诊断报告可序列化，verdict 能区分 ok / starved", async () => {
  const starved = diagnosticsReport("ai", await collectFromSources([failing("x", "403")]), 3);
  assert.equal(starved.verdict, "starved");
  assert.equal(starved.collected, 0);
  const healthy = diagnosticsReport("invest", await collectFromSources([source("y", [paper("1"), paper("2"), paper("3")])]), 3);
  assert.equal(healthy.verdict, "ok");
  assert.doesNotThrow(() => JSON.stringify(starved));
});

test("摘要失败率：偶尔一条可以忍，过半必须叫停", () => {
  assert.equal(summaryHealth("ai", 0, 20).fatal, false);
  assert.equal(summaryHealth("ai", 1, 20).fatal, false, "5% 失败属正常抖动");
  assert.equal(summaryHealth("ai", 20, 20).fatal, true, "全失败必须叫停（否则发布占位符）");
  const half = summaryHealth("invest", 5, 10);
  assert.equal(half.fatal, true);
  assert.match(half.reason, /不出稿/);
  assert.equal(summaryHealth("ai", 0, 0).fatal, false, "空集合交给 starvation 判断，不在这里重复报");
});

test("接线：digest-fetch 用体检结果决定出不出稿，且被 import 时不会自动跑", async () => {
  const code = await readFile(DIGEST_FETCH, "utf8");
  assert.match(code, /collectOrFail/, "收集要走带体检的入口");
  assert.match(code, /assertSummaryHealth/, "写文件前要验摘要失败率");
  assert.match(code, /starvationReason/, "要复用 lib 的饥饿判定");
  assert.match(code, /invokedDirectly/, "必须加 import guard，否则单测会真的联网抓 13 个源");
  assert.ok(!/no papers; skip/.test(code), "静默 skip 的旧路径必须消失");
  assert.ok(!/no news; skip/.test(code), "投资侧同理");
});

test("接线：workflow 会把逐源报告贴进 run 页面", async () => {
  const workflow = await readFile(DIGEST_WF, "utf8");
  assert.match(workflow, /reports\/digest-sources-\*\.json/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});
