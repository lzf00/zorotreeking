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
