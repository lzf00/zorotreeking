/**
 * 部署时顺手报行情新鲜度（第 163 轮）。
 *
 * 快照停在三个月前时，构建成功、门禁全绿、页面照常打开 —— 只有每周巡检那一行 warning
 * 会说话，而一周太慢（BLS 那次停了 101 天）。这条步骤不是门禁：陈旧是上游问题，
 * 挡住部署只会让内容一起停更，所以它只打 annotation。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function step() {
  const wf = parse(await read(".github/workflows/deploy.yml"));
  const steps = wf.jobs["build-and-deploy"].steps as { name?: string; run?: string; "continue-on-error"?: boolean }[];
  const found = steps.find((s) => (s.name ?? "").includes("Market data freshness"));
  assert.ok(found, "build-and-deploy 里要有行情新鲜度步骤");
  return found;
}

test("每次部署都检查行情快照年龄，但绝不挡住发布", async () => {
  const s = await step();
  assert.match(s.run ?? "", /check-market-data-age\.mjs/, "复用现成的看门狗，不要另写一套判定");
  assert.equal(s["continue-on-error"], true, "陈旧是上游问题，挡住部署会让内容一起停更");
  assert.doesNotMatch(s.run ?? "", /exit 1/, "不能自己把 job 弄红");
});

test("过旧时要在 annotation 里说清是哪一块、多少天", async () => {
  const s = await step();
  assert.match(s.run ?? "", /::warning title=行情快照过旧::/);
  assert.match(s.run ?? "", /ageDays/, "要带天数");
  // 踩过一次：warn 级行没有 stale 判断，导致"一致预期已作废"也被天天报
  assert.match(s.run ?? "", /r\.severity === "warn" && r\.stale/, "warn 级只在真的过旧时才提");
});

test("步骤摘要里附上表格，方便事后翻", async () => {
  const s = await step();
  assert.match(s.run ?? "", /GITHUB_STEP_SUMMARY/);
});

test("它依然不在阻塞门禁里（那条决定没变）", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.doesNotMatch(pkg.scripts.gate, /market-age/, "check:market-age 不进 gate");
});
