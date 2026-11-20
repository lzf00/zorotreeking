/**
 * 站内搜索探针（scripts/check-search.mjs）与部署里的权限修复。
 *
 * 事故（第 80 轮）：生产 20 个常见查询里 4 个直接 403 —— pagefind 碎片文件在，
 * 但 nginx 读不了（`rsync --no-perms` 留下的 0600 位）。页面、字体、CSS 全都正常，
 * 所以既有烟测一个都没红。这里锁住「能照出来」和「能自愈」两件事。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DEFAULT_QUERIES, extractResource, formatSearchProbe, summarizeSearchProbe } from "../scripts/check-search.mjs";

const DEPLOY_WF = new URL("../.github/workflows/deploy.yml", import.meta.url);
const AUDIT_WF = new URL("../.github/workflows/site-audit.yml", import.meta.url);
const PKG = new URL("../package.json", import.meta.url);

test("从 pagefind 报错里抽出状态码和资源路径", () => {
  const error = "Error: 403 fetching /pagefind/fragment/zh-cn_2e61058.pf_fragment at Worker";
  assert.deepEqual(extractResource(error), { status: 403, path: "/pagefind/fragment/zh-cn_2e61058.pf_fragment" });
  assert.deepEqual(extractResource("timeout"), { status: null, path: null });
});

test("有查询报错 → 整体失败；0 结果只算警告", () => {
  const broken = summarizeSearchProbe([
    { query: "ETF", total: 108 },
    { query: "三因子", error: "Error: 403 fetching /pagefind/fragment/zh-cn_2e61058.pf_fragment" },
  ]);
  assert.equal(broken.ok, false);
  assert.equal(broken.failures.length, 1);
  assert.deepEqual(broken.brokenResources[0], { status: 403, path: "/pagefind/fragment/zh-cn_2e61058.pf_fragment" });

  const empty = summarizeSearchProbe([{ query: "冷僻词", total: 0 }]);
  assert.equal(empty.ok, true, "0 结果是内容覆盖问题，不该让探针红");
  assert.equal(empty.empties.length, 1);
});

test("状态码能区分「没发布」和「读不了」—— 这是定位 deploy 问题的关键", () => {
  const notDeployed = summarizeSearchProbe([{ query: "x", error: "404 fetching /pagefind/fragment/x.pf_fragment" }]);
  const unreadable = summarizeSearchProbe([{ query: "x", error: "403 fetching /pagefind/fragment/x.pf_fragment" }]);
  assert.equal(notDeployed.brokenResources[0].status, 404);
  assert.equal(unreadable.brokenResources[0].status, 403);
  assert.match(formatSearchProbe(unreadable, "https://example.com"), /403 = 文件在但 nginx 读不了/);
});

test("全部通过时的文案不吓人，失败时给出可执行结论", () => {
  const ok = formatSearchProbe(summarizeSearchProbe([{ query: "ETF", total: 3 }]), "https://example.com");
  assert.match(ok, /搜索可用/);
  const bad = formatSearchProbe(summarizeSearchProbe([{ query: "ETF", error: "403 fetching /x" }]), "https://example.com");
  assert.match(bad, /搜索坏了/);
});

test("默认查询集覆盖多板块，且不为空", () => {
  assert.ok(DEFAULT_QUERIES.length >= 8);
  for (const query of ["ETF", "摄影", "徒步", "论文"]) assert.ok(DEFAULT_QUERIES.includes(query), `${query} 应在默认集里`);
});

test("部署接线：先补权限、再跑搜索验收，且搜索失败会走到回滚", async () => {
  const deploy = await readFile(DEPLOY_WF, "utf8");
  const repairAt = deploy.indexOf("Repair file readability in the active release");
  const probeAt = deploy.indexOf("node scripts/check-search.mjs --base=https://www.zorotreeking.online");
  const rollbackAt = deploy.indexOf("Roll back failed release");
  assert.ok(repairAt > 0, "要有权限修复步骤");
  assert.ok(probeAt > 0, "要有搜索验收步骤");
  assert.ok(repairAt < probeAt, "必须先修权限再验收，否则修好的那部分白验");
  assert.ok(probeAt < rollbackAt, "验收要排在回滚之前");
  assert.match(deploy, /find "\$dir" -type f ! -perm -o\+r/, "修复步骤要真的改权限位");
  assert.match(deploy, /Repair file readability[\s\S]{0,200}continue-on-error: true/, "修权限失败不该挡住发布，真正的闸门是搜索验收");
});

test("每周巡检也会跑搜索探针", async () => {
  const audit = await readFile(AUDIT_WF, "utf8");
  assert.match(audit, /node scripts\/check-search\.mjs/);
  const pkg = JSON.parse(await readFile(PKG, "utf8"));
  assert.equal(pkg.scripts["check:search"], "node scripts/check-search.mjs");
});

test("部署里用服务端 find 核对可读性，而不是用 HTTP 批量抓（会触发频控）", async () => {
  const deploy = await readFile(DEPLOY_WF, "utf8");
  const verifyAt = deploy.indexOf("Verify every file in the release is world-readable");
  assert.ok(verifyAt > 0, "要有服务端只读核对步骤");
  const probeAt = deploy.indexOf("node scripts/check-search.mjs");
  assert.ok(verifyAt < probeAt, "先修/核权限，再跑搜索探针");

  const verifyBlock = deploy.slice(verifyAt, verifyAt + 1600);
  assert.match(verifyBlock, /find "\$dir" -type f ! -perm -o\+r \| wc -l/, "要数出不可读文件数量");
  assert.match(verifyBlock, /exit \$status/, "还剩不可读文件时这一步必须失败");
  assert.match(verifyBlock, /for link in current previous/, "current 和 previous 都要核（回滚不能退回坏的那份）");

  // 反面断言：不能出现「HTTP 批量抓全站资产」这种会在生产上触发频控的实现
  assert.ok(!/check-deployed-assets/.test(deploy), "HTTP 全量抓取方案已废弃，别再接线");
});
