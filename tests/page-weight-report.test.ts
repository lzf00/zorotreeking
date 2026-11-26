/**
 * 「这个站用手机打开到底有多重」报表（第 222 轮）。
 *
 * 第 222 轮第一次测的时候差点得出错误结论：本地 `/api/**` 一律 404，
 * 而 404 的响应体就是整页 404 页面（约 130 KB），四个接口把 `/invest/` 虚增了 520 KB。
 * 报表必须自带这层剔除，否则"报表"会稳定地骗人。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { isLocalApiArtifact, summariseTransfer } from "../scripts/report-page-weight.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("本地 /api/** 的 404 响应体不算页面重量", () => {
  assert.equal(isLocalApiArtifact("/api/market/indices"), true);
  assert.equal(isLocalApiArtifact("/api/track"), true);
  assert.equal(isLocalApiArtifact("/_astro/client.js"), false);
  assert.equal(isLocalApiArtifact("/photos/uploads/a.jpg"), false);
});

test("剔除噪声后按类型汇总，并记下剔除了几条", () => {
  const rows = [
    { url: "https://x/photos/a.jpg", type: "image", bytes: 100 * 1024 },
    { url: "https://x/_astro/client.js", type: "script", bytes: 60 * 1024 },
    { url: "https://x/api/market/indices", type: "fetch", bytes: 130 * 1024 },
    { url: "https://x/api/track", type: "fetch", bytes: 130 * 1024 },
  ];
  const summary = summariseTransfer(rows);
  assert.equal(summary.skipped, 2, "两条 /api/** 噪声要被剔除");
  assert.equal(summary.requests, 2);
  assert.equal(summary.bytes, (100 + 60) * 1024);
  assert.equal(summary.byType.get("fetch"), undefined, "剔除后不该再有 fetch");
  assert.deepEqual(summary.top[0], ["image", 100 * 1024], "最重的一类排最前");
});

test("报表脚本说明里写清了它和闸门的分工，并带了这个坑的注释", async () => {
  const src = await read("scripts/report-page-weight.mjs");
  assert.match(src, /check:weight/, "要说清和闸门的区别");
  assert.match(src, /本地没有后端/, "要把 404 噪声这个坑写进脚本，不然下次还会踩");
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["report:weight"], "node scripts/report-page-weight.mjs");
});

test("预算判定：超过基线 15% 才红，未登记的页面只报不判（第 222 轮闸门模式）", async () => {
  const { judgeBudget } = await import("../scripts/report-page-weight.mjs");
  const baseline = { "/": 250, "/ai/": 260 };
  const within = judgeBudget(
    [{ path: "/", bytes: 260 * 1024 }, { path: "/ai/", bytes: 250 * 1024 }],
    baseline,
  );
  assert.equal(within.ok, true, "没超 15% 余量不该红");
  assert.deepEqual(within.unregistered, []);

  const slight = judgeBudget([{ path: "/", bytes: 280 * 1024 }], baseline);
  assert.equal(slight.ok, true, "超出 12% 仍在余量内（正常内容增长）");

  const bloated = judgeBudget([{ path: "/", bytes: 400 * 1024 }], baseline);
  assert.equal(bloated.ok, false, "涨 60% 必须红");
  assert.equal(bloated.over[0].path, "/");

  const fresh = judgeBudget([{ path: "/brand-new/", bytes: 900 * 1024 }], baseline);
  assert.equal(fresh.ok, true, "新页面不该让闸门红");
  assert.deepEqual(fresh.unregistered, ["/brand-new/"]);
});

test("基线文件是真的登记过的，单位是 KB（不是字节）", async () => {
  const raw = JSON.parse(await read("scripts/page-weight-runtime-baseline.json"));
  const paths = Object.keys(raw);
  assert.ok(paths.includes("/") && paths.includes("/invest/"));
  for (const [p, value] of Object.entries(raw)) {
    assert.ok(value > 10 && value < 5000, `${p} 的基线 ${value} 看起来不像 KB`);
  }
  // 单位错一次就够疼了：这次实现里把 KB 基线当字节比，上限变成了 1 KB，8 个页全红
  const src = await read("scripts/report-page-weight.mjs");
  assert.match(src, /limit \* 1024/, "基线是 KB，比较前必须换成字节");
});
